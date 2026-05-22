// ══════════════════════════════════════════════════
// operations/rewrite.ts
// The Rewrite block operation.
//
// Rewrite reads a source file (or each file in a folder),
// sends it to the LLM with a prompt, and overwrites the
// source file with the response. The source IS the destination.
//
// Folder behaviour (ADR 0004):
//   Unlike Process (which concatenates a folder into one call),
//   Rewrite loops over each file individually and overwrites each
//   one. This is the only way "folder + Rewrite" can have a
//   defined result — a single combined response can't be written
//   back to multiple separate files.
//
// Safety note:
//   This is a destructive operation. The original file content
//   is replaced. Dry-run mode (Milestone 5) will log exactly
//   which files would be overwritten before any run.
// ══════════════════════════════════════════════════

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { ChainBlock, BusyGoblinsSettings, CancelToken } from '../types';
import { readPromptFile, readVaultFile, editInPlace, isProtectedPath } from '../vault-io';
import { callOllama } from '../llm';
import { getNumCtx, getBudget } from '../settings';


// Runs a single Rewrite block.
// Returns the LLM response for the last file processed
// (available as 'previous' to the next block in the chain).
export async function runRewrite(
  app:            App,
  block:          ChainBlock,
  previousOutput: string,
  settings:       BusyGoblinsSettings,
  onStatus:       (msg: string) => void,
  cancelToken:    CancelToken,
  onToken?:       (count: number) => void,
  onInputChars?:  (chars: number) => void,
): Promise<string> {

  // ── Step 1: Read the prompt file ─────────────
  onStatus('Reading prompt file...');
  const prompt = await readPromptFile(app, block.promptFile, settings.defaultModel);
  if (!prompt) {
    throw new Error(
      `Prompt file not found: "${block.promptFile}"\n` +
      `Make sure the file exists in your vault before running.`
    );
  }

  // ── Runtime protected-path guard ─────────────
  // Validation catches this pre-run, but a preset loaded from an older
  // version (before protected paths existed) might slip through. Hard-stop
  // here before any LLM call or file modification happens.
  if (isProtectedPath(block.sourcePath, settings.protectedPaths)) {
    throw new Error(
      `"${block.sourcePath}" is protected. ` +
      `Remove it from Protected Paths in Settings to allow rewrites.`
    );
  }

  // ── Step 2: Build the prompt text ────────────
  let promptText = prompt.promptText.replace(/\{\{previous\}\}/g, previousOutput);

  if (block.injectPrevious && previousOutput) {
    promptText = [
      'Output from the previous step in this chain:',
      '',
      previousOutput,
      '',
      '---',
      '',
      promptText,
    ].join('\n');
  }

  // ── Step 3: Route by source type ─────────────
  // 'previous' is blocked by UI + validation — should never reach here.
  // 'file'   → one LLM call → overwrite that file
  // 'folder' → one LLM call PER FILE → overwrite each (ADR 0004)

  if (block.sourceType === 'previous') {
    throw new Error(
      'Rewrite cannot use "previous" as its source — there is no file to overwrite. ' +
      'Change the source to a file or folder.'
    );
  }

  if (block.sourceType === 'file') {
    return await rewriteFile(
      app, block.sourcePath, promptText, prompt.model,
      settings, onStatus, cancelToken, onToken, onInputChars,
    );
  }

  // sourceType === 'folder' — loop each file individually
  return await rewriteFolder(
    app, block.sourcePath, promptText, prompt.model,
    settings, onStatus, cancelToken, onToken, onInputChars,
  );
}


// ── Rewrite a single file ─────────────────────────
async function rewriteFile(
  app:           App,
  filePath:      string,
  promptText:    string,
  model:         string,
  settings:      BusyGoblinsSettings,
  onStatus:      (msg: string) => void,
  cancelToken:   CancelToken,
  onToken?:      (count: number) => void,
  onInputChars?: (chars: number) => void,
): Promise<string> {

  onStatus(`Reading "${filePath}"...`);
  const content = await readVaultFile(app, filePath);
  if (content === null) {
    throw new Error(
      `Source file not found: "${filePath}"\n` +
      `Make sure the file exists in your vault before running.`
    );
  }

  // ── Minimum content guard ─────────────────────
  // Sending an empty or near-empty file to an LLM causes it to stall —
  // it receives nothing meaningful to rewrite and either generates nothing
  // or spins waiting to find content that isn't there.
  // Catch this before the LLM call and surface a clear reason.
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 10) {
    throw new Error(
      `"${filePath}" has too little content to rewrite ` +
      `(${wordCount} word${wordCount === 1 ? '' : 's'} found after stripping frontmatter). ` +
      `Add more content before running.`
    );
  }

  // Enforce context budget
  const budget = getBudget(model);
  const sourceContent = content.length > budget
    ? content.slice(0, budget)
    : content;

  if (cancelToken.cancelled) { onStatus('Cancelled.'); return ''; }

  // Report input size before the LLM call so the panel can accumulate
  onInputChars?.(sourceContent.length + promptText.length);

  const kChars = Math.round(sourceContent.length / 1000);
  onStatus(`Rewriting "${filePath}" (~${kChars}k chars) with ${model}...`);

  let response: string;
  try {
    response = await callOllama({
      baseUrl:     settings.ollamaUrl,
      model:       model,
      system:      promptText,
      user:        sourceContent,
      numCtx:      getNumCtx(model),
      cancelToken: cancelToken,
      onToken:     onToken,
    });
  } catch (err) {
    if (cancelToken.cancelled) {
      onStatus('Cancelled — file not overwritten.');
      return '';
    }
    throw err;
  }

  if (cancelToken.cancelled || !response.trim()) {
    onStatus('Cancelled — file not overwritten.');
    return '';
  }

  onStatus(`Overwriting "${filePath}"...`);
  await editInPlace(app, filePath, response);
  onStatus(`✓ Rewrote "${filePath}"`);

  return response;
}


// ── Rewrite every file in a folder ───────────────
// Processes files one at a time (sequential, not parallel).
// Returns the last file's response so it can be used as 'previous'.
async function rewriteFolder(
  app:           App,
  folderPath:    string,
  promptText:    string,
  model:         string,
  settings:      BusyGoblinsSettings,
  onStatus:      (msg: string) => void,
  cancelToken:   CancelToken,
  onToken?:      (count: number) => void,
  onInputChars?: (chars: number) => void,
): Promise<string> {

  // Get all .md files in the folder
  const folder = app.vault.getFolderByPath(normalizePath(folderPath));
  if (!folder) {
    throw new Error(`Folder not found: "${folderPath}"`);
  }

  // Collect markdown files recursively using the statically-imported TFile/TFolder.
  // Cannot use dynamic import('obsidian') — static imports only in Obsidian plugins.
  const mdFiles: string[] = [];

  function collect(dir: TFolder): void {
    for (const child of dir.children) {
      if (child instanceof TFile && child.extension === 'md') {
        mdFiles.push(child.path);
      } else if (child instanceof TFolder) {
        collect(child);
      }
    }
  }
  collect(folder);
  mdFiles.sort();

  if (mdFiles.length === 0) {
    throw new Error(`No Markdown files found in folder: "${folderPath}"`);
  }

  let lastResponse = '';
  let skipped      = 0;
  const total      = mdFiles.length;

  for (let i = 0; i < total; i++) {
    if (cancelToken.cancelled) {
      onStatus(`Cancelled after ${i} of ${total} files.`);
      return lastResponse;
    }

    // ── Pre-check content before committing an LLM call ──
    // Read the file first and count words. If it's too short,
    // skip it with a status note and move on — don't stop the
    // whole run just because one file in the folder is empty.
    const preContent  = await readVaultFile(app, mdFiles[i]);
    const preWords    = preContent ? preContent.split(/\s+/).filter(Boolean).length : 0;

    if (preWords < 10) {
      onStatus(
        `⚠ Skipping file ${i + 1} of ${total}: "${mdFiles[i]}" ` +
        `— only ${preWords} word${preWords === 1 ? '' : 's'}, too short to rewrite.`
      );
      skipped++;
      continue;
    }

    onStatus(`Rewriting file ${i + 1} of ${total}: "${mdFiles[i]}"...`);

    lastResponse = await rewriteFile(
      app, mdFiles[i], promptText, model,
      settings, onStatus, cancelToken,
      i === total - 1 ? onToken : undefined, // only pass onToken for last file
      onInputChars, // accumulate input chars for every file
    );

    if (cancelToken.cancelled) return lastResponse;
  }

  const rewrote = total - skipped;
  if (skipped > 0) {
    onStatus(
      `✓ Rewrote ${rewrote} file${rewrote === 1 ? '' : 's'} in "${folderPath}" ` +
      `(${skipped} skipped — too short).`
    );
  } else {
    onStatus(`✓ Rewrote ${total} file${total === 1 ? '' : 's'} in "${folderPath}"`);
  }
  return lastResponse;
}

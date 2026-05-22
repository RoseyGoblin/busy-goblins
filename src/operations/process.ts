// ══════════════════════════════════════════════════
// operations/process.ts
// The Process block operation.
//
// Process reads content from a source (file, folder, or the
// previous block's output), combines it with a prompt,
// sends both to Ollama, and writes the response to a destination.
// The source file is never modified — output always goes elsewhere.
//
// It is the most general operation — Write and Rewrite are
// simplified versions of the same pipeline.
// ══════════════════════════════════════════════════

import { App } from 'obsidian';
import { ChainBlock, BusyGoblinsSettings, CancelToken } from '../types';
import { readVaultFile, readVaultFolder, readPromptFile, writeOutput } from '../vault-io';
import { callOllama } from '../llm';
import { getBudget, getNumCtx } from '../settings';


// Runs a single Process block.
//
// Parameters:
//   app            — the Obsidian app instance (vault access)
//   block          — the configured ChainBlock to run
//   previousOutput — the output string from the block above this one;
//                    used when block.sourceType = 'previous'
//   settings       — plugin settings (Ollama URL, default model)
//   onStatus       — callback to update the status display in the panel
//   cancelToken    — shared object checked before each slow step;
//                    if cancelled = true, the run stops cleanly
//   onToken        — optional callback fired for each token received
//                    from Ollama (used to update the token count display)
//
// Returns the LLM response string (available as 'previous' to the next block).
// Returns an empty string if cancelled or if destType = 'none' and nothing to return.
// Throws on hard errors (file not found, Ollama unreachable, etc.)
export async function runProcess(
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
  // The prompt file provides both the instruction text and
  // the model to use (from frontmatter, or plugin default).
  onStatus('Reading prompt file...');
  const prompt = await readPromptFile(app, block.promptFile, settings.defaultModel);
  if (!prompt) {
    throw new Error(
      `Prompt file not found: "${block.promptFile}"\n` +
      `Make sure the file exists in your vault before running.`
    );
  }

  // ── Step 2: Resolve the source content ───────
  // The source is what the LLM will read and process.
  // It becomes the "user" message sent to Ollama.
  onStatus('Reading source...');

  let sourceContent: string;

  if (block.sourceType === 'previous') {
    // Use whatever the prior block produced.
    // This is validated before run — it should never be empty here
    // unless something went wrong with the preceding block.
    if (!previousOutput) {
      throw new Error(
        'Source is set to "previous" but the preceding block produced no output. ' +
        'Check that the block above ran successfully.'
      );
    }
    sourceContent = previousOutput;

  } else if (block.sourceType === 'file') {
    const content = await readVaultFile(app, block.sourcePath);
    if (content === null) {
      throw new Error(
        `Source file not found: "${block.sourcePath}"\n` +
        `Make sure the file exists in your vault before running.`
      );
    }
    // Wrap in a labelled block so the LLM knows what it's reading
    sourceContent = `=== ${block.sourcePath} ===\n${content}`;

  } else {
    // sourceType = 'folder' — read and concatenate all .md files
    const { combined, filePaths } = await readVaultFolder(app, block.sourcePath);
    if (!combined) {
      throw new Error(
        `No readable Markdown files found in folder: "${block.sourcePath}"\n` +
        `The folder may be empty or contain only files with fewer than 30 words.`
      );
    }
    onStatus(`Reading ${filePaths.length} file(s) from "${block.sourcePath}"...`);
    sourceContent = combined;
  }

  // ── Step 3: Enforce character budget ─────────
  // Models have a maximum context window. If the source content is
  // too large, we truncate it rather than letting Ollama error out.
  const budget = getBudget(prompt.model);
  if (sourceContent.length > budget) {
    const kChars = Math.round(budget / 1000);
    onStatus(
      `⚠ Source content is large — truncating to ~${kChars}k characters ` +
      `to fit within ${prompt.model}'s context budget.`
    );
    sourceContent = sourceContent.slice(0, budget);
  }

  if (cancelToken.cancelled) { onStatus('Cancelled.'); return ''; }

  // ── Step 4: Build the final prompt text ──────
  //
  // Two mechanisms can inject the prior block's output into the
  // system prompt (instructions). Either one alone is fine; using
  // both is valid but the block card shows a warning to the user.
  //
  // Mechanism A — {{previous}} token in the prompt file:
  //   The user wrote {{previous}} somewhere in their prompt file.
  //   We substitute it with the prior output at that exact location.
  //   This gives fine-grained control over placement.
  //
  // Mechanism B — "Inject prior output into prompt" button:
  //   block.injectPrevious = true. We prepend the prior output to
  //   the top of the prompt automatically, without the user needing
  //   to edit their prompt file at all.
  //
  // If both are active, the prior output appears twice in the system
  // prompt. The block card warns the user about this.
  let promptText = prompt.promptText.replace(
    /\{\{previous\}\}/g,
    previousOutput,
  );

  if (block.injectPrevious && previousOutput) {
    // Prepend the prior output as clearly-labelled context so the
    // model knows what it is and where it came from.
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

  // ── Step 5: Report input character count ─────
  // Called before the LLM so the panel can accumulate across blocks.
  // Input tokens are estimated downstream as charCount ÷ 4.
  onInputChars?.(sourceContent.length + promptText.length);

  // ── Step 5: Send to Ollama ────────────────────
  // The prompt text goes in the system field (the LLM's instructions).
  // The source content goes in the user field (the material to process).
  // Placing them in separate roles is the standard chat-model pattern —
  // system = "here is your job", user = "here is the content to do it on".
  const kChars = Math.round(sourceContent.length / 1000);
  onStatus(`Sending ~${kChars}k chars to ${prompt.model}...`);

  let response: string;
  try {
    response = await callOllama({
      baseUrl:     settings.ollamaUrl,
      model:       prompt.model,
      system:      promptText,
      user:        sourceContent,
      numCtx:      getNumCtx(prompt.model),
      cancelToken: cancelToken,
      onToken:     onToken,
    });
  } catch (err) {
    if (cancelToken.cancelled) {
      onStatus('Cancelled — nothing written.');
      return '';
    }
    throw err;
  }

  if (cancelToken.cancelled || !response.trim()) {
    onStatus('Cancelled — nothing written.');
    return '';
  }

  // ── Step 5: Write the output ──────────────────
  if (block.destType !== 'none') {
    onStatus('Writing output to vault...');
    const writtenPath = await writeOutput(
      app,
      block.destType,
      block.destPath,
      block.destFilename,
      block.destOverwrite,
      response,
    );
    onStatus(`✓ Done — saved to ${writtenPath}`);
  } else {
    onStatus('✓ Done — output held in memory (no destination set).');
  }

  // Return the response so the chain executor can pass it as
  // 'previous' to the next block.
  return response;
}

// ══════════════════════════════════════════════════
// operations/write.ts
// The Write block operation.
//
// Write sends a prompt alone to the LLM — no source file.
// The AI generates new content purely from the instructions
// and writes it to a destination.
//
// Use Write when you want to create something new from scratch
// rather than transforming existing content.
//
// If a prior block ran and injectPrevious is true, the prior
// output is prepended to the prompt as context — useful when
// you want to generate something that relates to earlier steps
// but don't want the prior output to be the subject of the work.
// ══════════════════════════════════════════════════

import { App } from 'obsidian';
import { ChainBlock, BusyGoblinsSettings, CancelToken } from '../types';
import { readPromptFile, writeOutput } from '../vault-io';
import { callOllama }                  from '../llm';
import { getNumCtx }                   from '../settings';


export async function runWrite(
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

  // ── Step 2: Build the prompt text ────────────
  // Substitute {{previous}} if present in the prompt file.
  let promptText = prompt.promptText.replace(/\{\{previous\}\}/g, previousOutput);

  // If the "Inject prior output" button is on, prepend the prior
  // output as labelled context above the prompt instructions.
  // Write has no source, so this is the only way to bring in
  // prior chain output other than {{previous}} in the file.
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

  if (cancelToken.cancelled) { onStatus('Cancelled.'); return ''; }

  // Write sends only the prompt — no source content.
  // Input is the prompt text length alone.
  onInputChars?.(promptText.length);

  // ── Step 3: Call Ollama ───────────────────────
  // Write has no source content — the prompt IS the entire instruction.
  // The user message is empty; everything the LLM needs is in the system.
  onStatus(`Generating with ${prompt.model}...`);

  let response: string;
  try {
    response = await callOllama({
      baseUrl:     settings.ollamaUrl,
      model:       prompt.model,
      system:      promptText,
      user:        '',  // no source content — Write generates from the prompt alone
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

  // ── Step 4: Write the output ──────────────────
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

  return response;
}

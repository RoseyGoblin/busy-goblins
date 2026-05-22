// ══════════════════════════════════════════════════
// chain-executor.ts
// Runs a chain of blocks sequentially.
//
// The executor is a simple loop: for each block,
// resolve source → run operation → store output.
// Each block's output becomes the next block's
// 'previous' value if that block uses it.
//
// One cancel token covers the whole chain run.
// If cancelled, no further blocks execute and
// the current block stops at its next check point.
//
// Error handling:
//   If any block throws, the chain stops immediately.
//   The error is re-thrown so the panel can display it.
//   Blocks that didn't run are left with status 'idle'.
// ══════════════════════════════════════════════════

import { App } from 'obsidian';
import { ChainBlock, BusyGoblinsSettings, CancelToken } from './types';
import { runProcess } from './operations/process';
import { runWrite }   from './operations/write';
import { runRewrite } from './operations/rewrite';


// Runs all blocks in the chain sequentially.
//
// Parameters:
//   app            — Obsidian app instance
//   blocks         — the full block array from ChainManager
//   settings       — plugin settings (Ollama URL, default model)
//   onBlockStart   — called when a block begins running,
//                    with the block index and total count
//   onStatus       — called with status messages for the current block
//   onBlockDone    — called when a block finishes (pass/fail/cancel)
//   cancelToken    — shared object; set cancelled = true to stop the chain
//   onToken        — optional streaming token count callback
//
// Throws if any block errors — the panel catches and displays it.
export async function runChain(
  app:          App,
  blocks:       ChainBlock[],
  settings:     BusyGoblinsSettings,
  onBlockStart: (index: number, total: number) => void,
  onStatus:     (msg: string) => void,
  onBlockDone:  (index: number, status: ChainBlock['status']) => void,
  cancelToken:   CancelToken,
  onToken?:      (count: number) => void,
  onInputChars?: (chars: number) => void,
): Promise<void> {

  // previousOutput carries each block's result forward.
  // It starts empty — Block 1 has nothing before it.
  let previousOutput = '';

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // ── Check cancel before each block ──────────
    // This is the clean exit point — if the user cancelled
    // while a prior block was running, we stop here before
    // starting anything new.
    if (cancelToken.cancelled) {
      block.status = 'cancelled';
      onBlockDone(i, 'cancelled');
      continue; // mark remaining blocks cancelled but don't throw
    }

    block.status = 'running';
    onBlockStart(i, blocks.length);

    try {

      let output = '';

      // ── Route to the correct operation ────────
      if (block.operation === 'process') {
        output = await runProcess(
          app, block, previousOutput, settings,
          onStatus, cancelToken, onToken, onInputChars,
        );

      } else if (block.operation === 'write') {
        output = await runWrite(
          app, block, previousOutput, settings,
          onStatus, cancelToken, onToken, onInputChars,
        );

      } else if (block.operation === 'rewrite') {
        output = await runRewrite(
          app, block, previousOutput, settings,
          onStatus, cancelToken, onToken, onInputChars,
        );

      } else {
        throw new Error(`Unknown block operation: "${block.operation}"`);
      }

      // ── Store output ──────────────────────────
      // Save to the block so the panel can show it
      // and so the next block can use it as 'previous'.
      block.output = output;
      block.status = cancelToken.cancelled ? 'cancelled' : 'done';
      previousOutput = output;

      onBlockDone(i, block.status);

    } catch (err) {
      // ── Handle block error ────────────────────
      block.status       = 'error';
      block.errorMessage = (err instanceof Error) ? err.message : String(err);

      onBlockDone(i, 'error');

      // Re-throw with block number context so the panel
      // can show "Block 2 failed: [reason]"
      throw new Error(
        `Block ${i + 1} failed: ${block.errorMessage}`
      );
    }
  }
}

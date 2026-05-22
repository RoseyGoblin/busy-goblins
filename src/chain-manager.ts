// ══════════════════════════════════════════════════
// chain-manager.ts
// Holds and manages the array of ChainBlocks.
//
// The panel owns one ChainManager instance for the
// lifetime of the view. All block add/remove/update
// operations go through here so there's one clear
// source of truth for the chain's state.
//
// The onChange callback is fired whenever the block
// array changes shape (add or remove). The panel uses
// it to re-render the block cards.
//
// Field edits (user typing in a card) go through
// updateBlock() and do NOT fire onChange — the card
// already re-renders its own DOM, no full re-render needed.
// ══════════════════════════════════════════════════

import { ChainBlock, BlockStatus } from './types';


// ── createEmptyBlock ──────────────────────────────
// Generates a blank ChainBlock with safe defaults.
// Called by addBlock() and by the panel on first open.
export function createEmptyBlock(): ChainBlock {
  return {
    // Random 8-char ID — used as a stable key for the UI
    id:           Math.random().toString(36).slice(2, 10),
    operation:    'process',
    sourceType:   'file',
    sourcePath:   '',
    promptFile:     '',
    injectPrevious: false,
    destType:       'file',
    destPath:     '',
    destFilename: '',
    destOverwrite: false,
    // Runtime state — cleared before each run
    status:       'idle',
    output:       '',
    errorMessage: '',
  };
}


// ══════════════════════════════════════════════════
// ChainManager
// ══════════════════════════════════════════════════
export class ChainManager {

  // The ordered list of blocks. Index = position in the chain.
  private blocks: ChainBlock[];

  // Fired when the block array changes shape (add/remove).
  // NOT fired on field edits — those don't change the array structure.
  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
    // Start with one empty block so the panel is never empty
    this.blocks = [createEmptyBlock()];
  }

  // ── Read ──────────────────────────────────────

  // Returns the full block array. Read-only — never mutate directly.
  getBlocks(): ChainBlock[] {
    return this.blocks;
  }

  // Returns the number of blocks in the chain.
  getCount(): number {
    return this.blocks.length;
  }

  // ── Write ─────────────────────────────────────

  // Adds a new empty block at the end of the chain.
  addBlock(): void {
    this.blocks.push(createEmptyBlock());
    this.onChange();
  }

  // Removes the block at the given index.
  // No-op if only one block remains — the chain can never be empty.
  removeBlock(index: number): void {
    if (this.blocks.length <= 1) return;
    this.blocks.splice(index, 1);
    this.onChange();
  }

  // Updates the block at the given index with new data.
  // Called by block card's onChange when any field changes.
  // Does NOT fire onChange — no re-render needed for field edits.
  updateBlock(index: number, block: ChainBlock): void {
    if (index < 0 || index >= this.blocks.length) return;
    this.blocks[index] = block;
  }

  // Replaces the entire block array with new blocks.
  // Used when loading a preset. Fires onChange so the panel re-renders.
  setBlocks(blocks: ChainBlock[]): void {
    this.blocks = blocks.length > 0 ? blocks : [createEmptyBlock()];
    this.onChange();
  }

  // ── Runtime state ─────────────────────────────

  // Resets all block runtime fields before a new chain run.
  // Clears status, output, and errorMessage so stale results
  // from a previous run don't bleed into the new one.
  resetRuntimeState(): void {
    for (const block of this.blocks) {
      block.status       = 'idle';
      block.output       = '';
      block.errorMessage = '';
    }
  }

  // Updates just the status of one block.
  // Used by the panel to update status dots during a run.
  setBlockStatus(index: number, status: BlockStatus, errorMessage = ''): void {
    if (index < 0 || index >= this.blocks.length) return;
    this.blocks[index].status       = status;
    this.blocks[index].errorMessage = errorMessage;
  }

  // Marks all blocks at or after startIndex as 'cancelled'.
  // Called when a run is cancelled mid-chain.
  cancelFrom(startIndex: number): void {
    for (let i = startIndex; i < this.blocks.length; i++) {
      if (this.blocks[i].status === 'idle' || this.blocks[i].status === 'running') {
        this.blocks[i].status = 'cancelled';
      }
    }
  }
}

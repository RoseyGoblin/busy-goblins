// ══════════════════════════════════════════════════
// validation.ts
// Checks whether a chain is safe and complete enough to run.
//
// All checks here are synchronous — vault path existence is
// checked via the vault API (no async needed). Ollama
// reachability is handled separately in the panel because
// it requires a network call.
//
// Returns a list of issues. If the list is empty, the chain
// is valid and the Run button should be enabled.
// ══════════════════════════════════════════════════

import { App, normalizePath } from 'obsidian';
import { ChainBlock, BusyGoblinsSettings } from './types';
import { isProtectedPath } from './vault-io';


// ── Types ─────────────────────────────────────────

export interface ValidationIssue {
  blockIndex: number; // 0-based block number; -1 = chain-level issue
  message:    string; // human-readable, shown in tooltip and status bar
}

export interface ValidationResult {
  valid:      boolean;
  issues:     ValidationIssue[];
  // Convenience: the message from the first issue, ready for the tooltip.
  // Empty string when valid.
  firstIssue: string;
}


// ── Main validator ────────────────────────────────
// Runs all checks and returns the full result.
// Called on: panel open, every block field blur, before Run.
export function validateChain(
  blocks:   ChainBlock[],
  app:      App,
  settings: BusyGoblinsSettings,
): ValidationResult {

  const issues: ValidationIssue[] = [];

  // ── Chain-level checks ─────────────────────────
  if (blocks.length === 0) {
    issues.push({ blockIndex: -1, message: 'Chain has no blocks. Add at least one block.' });
    return finish(issues);
  }

  // ── Per-block checks ───────────────────────────
  for (let i = 0; i < blocks.length; i++) {
    const b   = blocks[i];
    const num = `Block ${i + 1}`;

    // ── Prompt file ───────────────────────────
    if (!b.promptFile.trim()) {
      issues.push({ blockIndex: i, message: `${num}: no prompt file set.` });
    } else if (!app.vault.getFileByPath(normalizePath(b.promptFile))) {
      issues.push({ blockIndex: i, message: `${num}: prompt file not found — "${b.promptFile}"` });
    }

    // ── Operation-specific source/dest rules ──
    if (b.operation === 'rewrite') {
      // Rewrite: needs a real file or folder — never 'previous'
      if (b.sourceType === 'previous') {
        issues.push({
          blockIndex: i,
          message: `${num}: Rewrite cannot use "previous" as source — choose a file or folder.`,
        });
      } else if (!b.sourcePath.trim()) {
        issues.push({ blockIndex: i, message: `${num}: Rewrite needs a source file or folder.` });
      } else {
        checkSourceExists(app, b, i, num, issues);

        // Protected path check — Rewrite always overwrites, so any protected
        // source is an unconditional block regardless of overwrite setting.
        if (isProtectedPath(b.sourcePath, settings.protectedPaths)) {
          issues.push({
            blockIndex: i,
            message: `${num}: "${b.sourcePath}" is protected — remove it from Protected Paths in Settings to allow rewrites.`,
          });
        }
      }
      // No destination validation for Rewrite — always overwrites source

    } else if (b.operation === 'write') {
      // Write: no source, but needs a destination
      checkDestination(b, i, num, issues);
      checkProtectedDest(b, i, num, settings.protectedPaths, issues);

    } else {
      // Process: needs source + destination
      if (b.sourceType === 'previous' && i === 0) {
        issues.push({
          blockIndex: i,
          message: `${num}: cannot use "previous" — nothing precedes Block 1.`,
        });
      } else if (b.sourceType !== 'previous') {
        if (!b.sourcePath.trim()) {
          issues.push({ blockIndex: i, message: `${num}: no source file or folder set.` });
        } else {
          checkSourceExists(app, b, i, num, issues);
        }
      }
      checkDestination(b, i, num, issues);
      checkProtectedDest(b, i, num, settings.protectedPaths, issues);
    }
  }

  return finish(issues);
}


// ── Helpers ───────────────────────────────────────

// Checks that the source path actually exists in the vault.
function checkSourceExists(
  app:    App,
  b:      ChainBlock,
  i:      number,
  num:    string,
  issues: ValidationIssue[],
): void {
  const path = normalizePath(b.sourcePath);

  if (b.sourceType === 'file') {
    if (!app.vault.getFileByPath(path)) {
      issues.push({ blockIndex: i, message: `${num}: source file not found — "${b.sourcePath}"` });
    }
  } else if (b.sourceType === 'folder') {
    if (!app.vault.getFolderByPath(path)) {
      issues.push({ blockIndex: i, message: `${num}: source folder not found — "${b.sourcePath}"` });
    }
  }
}

// Checks destination fields are filled (does not require the file to exist —
// new files are created on write).
function checkDestination(
  b:      ChainBlock,
  i:      number,
  num:    string,
  issues: ValidationIssue[],
): void {
  if (b.destType === 'file' && !b.destPath.trim()) {
    issues.push({ blockIndex: i, message: `${num}: no destination file path set.` });
  }
  if (b.destType === 'folder') {
    if (!b.destPath.trim()) {
      issues.push({ blockIndex: i, message: `${num}: no destination folder set.` });
    }
    if (!b.destFilename.trim()) {
      issues.push({ blockIndex: i, message: `${num}: no destination filename set.` });
    }
  }
}

// Checks whether a Process/Write block's destination is protected.
// Only fires when destOverwrite = true — that's the only case where
// an existing file would be silently replaced. Versioned writes
// (destOverwrite = false) always create a new file and are safe.
function checkProtectedDest(
  b:              ChainBlock,
  i:              number,
  num:            string,
  protectedPaths: string[],
  issues:         ValidationIssue[],
): void {
  if (!b.destOverwrite) return;          // versioned write — nothing gets overwritten
  if (b.destType === 'none') return;     // no destination — nothing gets written

  const destPath = b.destType === 'file' ? b.destPath : b.destPath;
  if (!destPath.trim()) return;          // empty path — caught by checkDestination

  if (isProtectedPath(destPath, protectedPaths)) {
    issues.push({
      blockIndex: i,
      message: `${num}: destination "${destPath}" is protected — turn off "Allow overwrite" or remove it from Protected Paths in Settings.`,
    });
  }
}


// Builds the final result object.
function finish(issues: ValidationIssue[]): ValidationResult {
  return {
    valid:      issues.length === 0,
    issues:     issues,
    firstIssue: issues.length > 0 ? issues[0].message : '',
  };
}

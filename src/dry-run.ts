// ══════════════════════════════════════════════════
// dry-run.ts
// Produces a human-readable preview of what a chain would do.
//
// No LLM calls. No file writes. No vault modifications.
// Reads prompt files to extract the model name, checks whether
// source/destination paths exist, and formats a plain-English log.
//
// Output is a string of Markdown-ish text displayed in the panel.
// ══════════════════════════════════════════════════

import { App, normalizePath } from 'obsidian';
import { ChainBlock, BusyGoblinsSettings } from './types';


// Runs a dry-run pass over the chain and returns a formatted log string.
// Async because it reads prompt files to extract model info from frontmatter.
export async function dryRunChain(
  blocks:   ChainBlock[],
  app:      App,
  settings: BusyGoblinsSettings,
): Promise<string> {

  if (blocks.length === 0) {
    return 'No blocks in chain — nothing to preview.';
  }

  const lines: string[] = [];

  lines.push(`DRY RUN — ${blocks.length} block${blocks.length === 1 ? '' : 's'}`);
  lines.push('No files will be read, called, or modified during dry run.');
  lines.push('');

  for (let i = 0; i < blocks.length; i++) {
    const b   = blocks[i];
    const num = `Block ${i + 1}`;

    lines.push(`${'─'.repeat(40)}`);
    lines.push(`${num} · ${b.operation.toUpperCase()}`);

    // ── Source ────────────────────────────────
    if (b.operation === 'write') {
      lines.push(`  Source   (none — Write generates from prompt alone)`);
    } else if (b.sourceType === 'previous') {
      lines.push(`  Source   Output from Block ${i} (previous)`);
    } else if (b.sourceType === 'file') {
      const exists = !!app.vault.getFileByPath(normalizePath(b.sourcePath));
      const icon   = exists ? '✓' : '✗ NOT FOUND';
      lines.push(`  Source   ${b.sourcePath || '(not set)'} ${icon}`);
    } else {
      // folder
      const folder  = app.vault.getFolderByPath(normalizePath(b.sourcePath));
      const icon    = folder ? '✓' : '✗ NOT FOUND';
      // Count the files if the folder exists
      const fileCount = folder
        ? app.vault.getMarkdownFiles().filter(f => f.path.startsWith(b.sourcePath)).length
        : 0;
      const countNote = folder ? ` (${fileCount} .md file${fileCount === 1 ? '' : 's'})` : '';
      lines.push(`  Source   ${b.sourcePath || '(not set)'}/ ${icon}${countNote}`);
    }

    // ── Inject prior output ───────────────────
    if (b.injectPrevious && i > 0) {
      lines.push(`  Inject   Prior output will be added to top of prompt instructions`);
    }

    // ── Prompt file ───────────────────────────
    const promptPath = normalizePath(b.promptFile);
    const promptFile = app.vault.getFileByPath(promptPath);

    if (!b.promptFile.trim()) {
      lines.push(`  Prompt   (not set)`);
    } else if (!promptFile) {
      lines.push(`  Prompt   ${b.promptFile} ✗ NOT FOUND`);
    } else {
      // Read the prompt file to extract the model from frontmatter
      let model = settings.defaultModel;
      try {
        const raw   = await app.vault.read(promptFile);
        const match = raw.match(/^---[\s\S]*?model:\s*(.+?)\s*[\r\n][\s\S]*?---/);
        if (match) model = match[1].trim();
      } catch {
        // If read fails, fall back to default model — non-fatal
      }
      lines.push(`  Prompt   ${b.promptFile} ✓  [model: ${model}]`);
    }

    // ── Destination ───────────────────────────
    if (b.operation === 'rewrite') {
      // Destination IS the source
      if (b.sourceType === 'file') {
        lines.push(`  Output → OVERWRITES "${b.sourcePath}"`);
      } else if (b.sourceType === 'folder') {
        lines.push(`  Output → OVERWRITES each file in "${b.sourcePath}/" individually`);
      } else {
        lines.push(`  Output → (source not set)`);
      }
    } else if (b.destType === 'none') {
      lines.push(`  Output → (none — held in memory for next block)`);
    } else if (b.destType === 'file') {
      const destExists = b.destPath && !!app.vault.getFileByPath(normalizePath(b.destPath));
      if (!b.destPath.trim()) {
        lines.push(`  Output → (destination not set)`);
      } else if (destExists && !b.destOverwrite) {
        // File exists, no overwrite — will version
        const withoutExt = b.destPath.endsWith('.md') ? b.destPath.slice(0, -3) : b.destPath;
        lines.push(`  Output → ${b.destPath} exists → will write "${withoutExt}-2.md" (or next available)`);
      } else if (destExists && b.destOverwrite) {
        lines.push(`  Output → OVERWRITES ${b.destPath}`);
      } else {
        const path = b.destPath.endsWith('.md') ? b.destPath : b.destPath + '.md';
        lines.push(`  Output → ${path} (new file)`);
      }
    } else {
      // destType = 'folder'
      if (!b.destPath.trim() || !b.destFilename.trim()) {
        lines.push(`  Output → (destination folder or filename not set)`);
      } else {
        const targetName = b.destFilename.endsWith('.md') ? b.destFilename : b.destFilename + '.md';
        const targetPath = `${b.destPath}/${targetName}`;
        const exists     = !!app.vault.getFileByPath(normalizePath(targetPath));

        if (exists && !b.destOverwrite) {
          lines.push(`  Output → ${targetPath} exists → will write "${b.destFilename}-2.md" (or next available)`);
        } else if (exists && b.destOverwrite) {
          lines.push(`  Output → OVERWRITES ${targetPath}`);
        } else {
          lines.push(`  Output → ${targetPath} (new file)`);
        }
      }
    }

    lines.push('');
  }

  lines.push(`${'─'.repeat(40)}`);
  lines.push('Run the chain to execute the above. Dry run made no changes.');

  return lines.join('\n');
}

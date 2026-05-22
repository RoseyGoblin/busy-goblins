// ══════════════════════════════════════════════════
// vault-io.ts
// All vault read and write operations for Busy Goblins.
//
// This is the single place that touches the Obsidian vault.
// Every operation module imports from here — no other file
// calls app.vault directly except this one.
//
// Functions:
//   readVaultFile   — read one .md file, strip frontmatter
//   readVaultFolder — read all .md files in a folder, concatenate
//   readPromptFile  — read a prompt .md file, parse model from frontmatter
//   writeOutput     — write LLM output to the correct destination
//   editInPlace     — overwrite a file with new content (Edit operation)
//   ensureFolder    — create a folder if it doesn't exist
//   toSafeFilename  — make a string safe to use in a filename
//   makeTimestamp   — compact timestamp string for versioned filenames
// ══════════════════════════════════════════════════

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { DestType } from './types';


// ── Internal: Frontmatter Parser ─────────────────
// Parses simple key: value YAML frontmatter from a markdown string.
// Only handles flat key: value pairs — no nested structures.
// Returns an empty object if there's no frontmatter or parsing fails.
function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Frontmatter must begin at the very first character of the file
  if (!content.startsWith('---')) return result;

  const end = content.indexOf('---', 3);
  if (end === -1) return result;

  const block = content.slice(3, end);

  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const key = line.slice(0, colon).trim();
    // Strip surrounding quotes from the value if present
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');

    if (key) result[key] = val;
  }

  return result;
}

// ── Internal: Frontmatter Stripper ───────────────
// Returns the file body with the YAML frontmatter block removed.
// If there's no frontmatter, returns the content unchanged.
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('---', 3);
  if (end === -1) return content;
  return content.slice(end + 3).trim();
}


// ── Timestamp Generator ───────────────────────────
// Produces a compact timestamp for versioned output filenames.
// Format: YYYYMMDD-HHMMSS
// Example: "20260520-143022"
//
// Used when destOverwrite = false and the destination file already exists.
// Appended before the .md extension: "summary.md" → "summary-20260520-143022.md"
export function makeTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const Y = now.getFullYear();
  const M = pad(now.getMonth() + 1);
  const D = pad(now.getDate());
  const h = pad(now.getHours());
  const m = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `${Y}${M}${D}-${h}${m}${s}`;
}


// ── Auto-Generated Filename Sanitiser ────────────
// Used when Busy Goblins needs to build a filename from an
// arbitrary string (like a folder path or agent name).
// Converts everything non-alphanumeric to hyphens so the
// result is guaranteed safe on all platforms.
//
// Do NOT use this for user-supplied filenames — it's too
// aggressive and destroys intentional underscores/spaces.
// Use sanitizeUserFilename() for those.
//
// Examples:
//   "Show/01 Bible"  → "Show-01-Bible"
//   "my notes"       → "my-notes"
export function toSafeFilename(s: string): string {
  return s
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}


// ── User-Supplied Filename Sanitiser ─────────────
// Used for the destFilename field that the user types themselves.
// Only removes characters that are genuinely illegal in filenames
// on Windows, macOS, and Linux. Preserves underscores, spaces,
// hyphens, dots, and anything else that's actually valid.
//
// Illegal characters stripped:
//   Windows: < > : " / \ | ? * and control chars (0x00–0x1f)
//   Mac/Linux: / and null byte (covered by the Windows set)
//
// Examples:
//   "Testing_"        → "Testing_"   (underscore preserved ✓)
//   "my notes"        → "my notes"   (space preserved ✓)
//   "file:name?"      → "filename"   (colon and ? stripped)
//   ""                → "output"     (fallback for empty input)
export function sanitizeUserFilename(s: string): string {
  const cleaned = s
    .trim()
    // Strip characters that filesystems reject
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    // Strip leading dots (hidden files on Mac/Linux)
    .replace(/^\.+/, '')
    .trim();

  // Fall back to 'output' if the user's input was entirely illegal chars
  return cleaned || 'output';
}


// ── Case-Insensitive File Finder ─────────────────
// Obsidian's vault cache is case-sensitive — getFileByPath('testing.md')
// returns null even when 'Testing.md' exists.
// On Windows the filesystem is case-insensitive, so vault.create('testing.md')
// fails with "File already exists" when 'Testing.md' is already there.
//
// This helper does a case-insensitive scan as a fallback for the write path,
// so we find the existing file and modify it rather than crashing.
// Only used for WRITING — reads should stay strict so a wrong-case source
// path is caught as a real "file not found" error.
function findFileCaseInsensitive(app: App, path: string): TFile | null {
  const lower = normalizePath(path).toLowerCase();
  return app.vault.getMarkdownFiles().find(
    f => f.path.toLowerCase() === lower,
  ) ?? null;
}


// ── Protected Path Checker ────────────────────────
// Returns true if targetPath is exactly a protected path OR is
// nested inside one (i.e. the protected path is a parent folder).
//
// Examples:
//   target "Key-Docs/my-file.md", protected "Key-Docs"   → true
//   target "Key-Docs",             protected "Key-Docs"   → true
//   target "Other/file.md",        protected "Key-Docs"   → false
//
// Used by validation (pre-run) and rewrite.ts (runtime guard).
export function isProtectedPath(targetPath: string, protectedPaths: string[]): boolean {
  if (!protectedPaths.length) return false;
  const t = normalizePath(targetPath).toLowerCase();
  return protectedPaths.some(pp => {
    const p = normalizePath(pp).toLowerCase();
    return t === p || t.startsWith(p + '/');
  });
}


// ── Folder Creator ────────────────────────────────
// Creates a folder at the given vault path if it doesn't already exist.
// Safe to call even if the folder exists — it's a no-op in that case.
// Throws if a FILE is already blocking that path.
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalised = normalizePath(folderPath);
  if (app.vault.getFolderByPath(normalised)) return; // already exists

  // Check if a file is blocking the path
  if (app.vault.getFileByPath(normalised)) {
    throw new Error(
      `Cannot create folder at "${normalised}" — a file already exists there.`
    );
  }

  await app.vault.createFolder(normalised);
}


// ── Single File Reader ────────────────────────────
// Reads one vault .md file and returns its content with frontmatter stripped.
// Returns null if the file doesn't exist.
export async function readVaultFile(
  app: App,
  filePath: string,
): Promise<string | null> {
  const file = app.vault.getFileByPath(normalizePath(filePath));
  if (!file) return null;

  const raw = await app.vault.read(file);
  return stripFrontmatter(raw);
}


// ── Folder Reader ─────────────────────────────────
// Reads all .md files in a folder (recursively) and returns them
// as a concatenated context string suitable for an LLM.
//
// Each file is formatted as:
//   === path/to/file.md ===
//   [file content]
//
// Files with fewer than 30 words after stripping frontmatter are skipped —
// they're usually empty stubs or template placeholders that don't contribute
// useful signal to the model.
//
// Returns: the combined string and a list of included file paths.
export async function readVaultFolder(
  app: App,
  folderPath: string,
): Promise<{ combined: string; filePaths: string[] }> {

  const folder = app.vault.getFolderByPath(normalizePath(folderPath));
  if (!folder) return { combined: '', filePaths: [] };

  const results: { path: string; content: string }[] = [];

  // Walk all files recursively within the folder
  async function traverse(dir: TFolder): Promise<void> {
    for (const child of dir.children) {
      if (child instanceof TFile && child.extension === 'md') {
        const raw     = await app.vault.read(child);
        const content = stripFrontmatter(raw);
        const words   = content.split(/\s+/).filter(Boolean).length;
        if (words < 30) continue; // skip short/empty files
        results.push({ path: child.path, content });
      } else if (child instanceof TFolder) {
        await traverse(child);
      }
    }
  }

  await traverse(folder);
  results.sort((a, b) => a.path.localeCompare(b.path));

  // Format each file as a clearly labelled block
  const parts = results.map(f => `=== ${f.path} ===\n${f.content}`);

  return {
    combined:  parts.join('\n\n'),
    filePaths: results.map(f => f.path),
  };
}


// ── Prompt File Reader ────────────────────────────
// Reads a vault .md file as a Busy Goblins prompt.
// Extracts the model from YAML frontmatter if present.
// Returns the body text (frontmatter stripped) as the prompt.
//
// Frontmatter format:
//   ---
//   model: qwen2.5:32b
//   ---
//   Your prompt text here...
//
// Returns null if the file doesn't exist.
export async function readPromptFile(
  app: App,
  filePath: string,
  defaultModel: string,
): Promise<{ promptText: string; model: string } | null> {

  const file = app.vault.getFileByPath(normalizePath(filePath));
  if (!file) return null;

  const raw        = await app.vault.read(file);
  const meta       = parseFrontmatter(raw);
  const promptText = stripFrontmatter(raw);
  const model      = meta['model']?.trim() || defaultModel;

  return { promptText, model };
}


// ── Output Writer ─────────────────────────────────
// Writes LLM output to the correct vault location.
//
// destType = 'file':
//   Writes to destPath. If the path doesn't end in .md, .md is added
//   automatically — so users can type "my-note" or "my-note.md" and
//   both work correctly.
//
// destType = 'folder':
//   Writes to destPath/destFilename.md, creating the folder if needed.
//
// Versioning (when destOverwrite = false and the target file exists):
//   Appends a counter suffix: "summary.md" → "summary-2.md" → "summary-3.md"
//   The original file is never silently destroyed.
//
// destType = 'none':
//   Nothing is written. Returns an empty string.
//   The output is still available as 'previous' to the next block.
//
// Returns the vault-relative path of the written file, or '' for 'none'.
export async function writeOutput(
  app: App,
  destType: DestType,
  destPath: string,
  destFilename: string,
  destOverwrite: boolean,
  content: string,
): Promise<string> {

  if (destType === 'none') return '';

  let targetPath: string;

  if (destType === 'file') {
    // Normalise the path and ensure it ends in .md.
    // Users often type "my-note" without the extension — we add it
    // so the file is always a proper Markdown file in the vault.
    let path = normalizePath(destPath);
    if (!path.endsWith('.md')) path = path + '.md';
    targetPath = path;
  } else {
    // 'folder' — build full path from folder + filename
    const folder   = normalizePath(destPath);
    await ensureFolder(app, folder);
    // sanitizeUserFilename preserves underscores and spaces —
    // the user typed this name intentionally, we only strip
    // characters that filesystems actually reject.
    const safeName = sanitizeUserFilename(destFilename);
    targetPath     = normalizePath(`${folder}/${safeName}.md`);
  }

  // ── Versioning logic ───────────────────────────
  // Uses getFileByPath first (fast), then falls back to the case-insensitive
  // finder for Windows where 'testing.md' and 'Testing.md' are the same file
  // but getFileByPath only matches the exact-case string.
  const existingAtTarget = app.vault.getFileByPath(targetPath)
    ?? findFileCaseInsensitive(app, targetPath);

  if (!destOverwrite && existingAtTarget) {
    // Strip .md, then try -2, -3, -4 … until a free name is found.
    const base = targetPath.slice(0, -3);
    let counter = 2;
    let candidate = `${base}-${counter}.md`;

    while (
      app.vault.getFileByPath(candidate) ??
      findFileCaseInsensitive(app, candidate)
    ) {
      counter++;
      candidate = `${base}-${counter}.md`;
      if (counter > 999) {
        candidate = `${base}-${makeTimestamp()}.md`;
        break;
      }
    }
    targetPath = candidate;
  }

  // ── Write the file ─────────────────────────────
  // Re-check after versioning in case targetPath changed.
  const existingFile = app.vault.getFileByPath(targetPath)
    ?? findFileCaseInsensitive(app, targetPath);

  if (existingFile) {
    // File exists — overwrite with vault.modify().
    // vault.modify() is the correct API for a straight overwrite: we already
    // have the full new content from the LLM so there is no read needed.
    // vault.process() (read-modify-write) threw "File already exists" in some
    // Obsidian 1.7+ builds and is not appropriate here anyway.
    await app.vault.modify(existingFile, content);

  } else {
    // File doesn't exist — ensure the parent folder and create.
    const pathParts = targetPath.split('/');
    if (pathParts.length > 1) {
      await ensureFolder(app, pathParts.slice(0, -1).join('/'));
    }

    // Last-resort catch: if something created the file between our check and
    // this call (external copy, race, etc.), fall back to modify instead of
    // surfacing "File already exists" as a chain failure.
    try {
      await app.vault.create(targetPath, content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('already exists')) {
        const raceFile = app.vault.getFileByPath(targetPath)
          ?? findFileCaseInsensitive(app, targetPath);
        if (raceFile) {
          await app.vault.modify(raceFile, content);
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  return targetPath;
}


// ── In-Place Editor ───────────────────────────────
// Overwrites a vault file's content with new text.
// Used by the Edit operation — replaces the source file
// with the LLM's transformed version.
//
// Uses Vault.process() for atomic writes per Obsidian guidelines.
// Throws if the file doesn't exist.
export async function editInPlace(
  app: App,
  filePath: string,
  newContent: string,
): Promise<void> {
  const file = app.vault.getFileByPath(normalizePath(filePath));
  if (!file) {
    throw new Error(`Cannot edit "${filePath}" — file not found in vault.`);
  }
  await app.vault.process(file, () => newContent);
}

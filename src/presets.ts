// ══════════════════════════════════════════════════
// presets.ts
// Save and load chain configurations as .json files in the vault.
//
// Each preset is one file: presetsFolder/slug.json
// The slug is the name lowercased and hyphenated so it's safe
// as a filename on all platforms.
//
// Preset files contain the chain config but NOT runtime state —
// status, output, and errorMessage are stripped on save.
// They are added back as blank fields when a preset is loaded.
// ══════════════════════════════════════════════════

import { App, TFile, normalizePath } from 'obsidian';
import { ChainBlock, Preset, BusyGoblinsSettings } from './types';
import { ensureFolder } from './vault-io';

// The only operations valid in v1. Used to filter preset blocks on load
// so a crafted or outdated .json can't introduce an unknown operation.
const VALID_OPERATIONS = new Set<string>(['process', 'write', 'rewrite']);


// ── Slug helper ───────────────────────────────────
// Converts a preset name to a safe, lowercase filename.
// "Daily Show Notes Pipeline" → "daily-show-notes-pipeline"
export function slugifyPresetName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    || 'preset'
  );
}


// ── Save ──────────────────────────────────────────
// Saves the current chain as a preset .json file.
// Strips runtime state (status, output, errorMessage) before writing.
//
// Returns:
//   path       — vault-relative path of the written file
//   wasExisting — true if a preset with this name already existed
//                 (the caller can ask the user before overwriting)
export async function savePreset(
  name:        string,
  description: string,
  blocks:      ChainBlock[],
  app:         App,
  settings:    BusyGoblinsSettings,
): Promise<{ path: string; wasExisting: boolean }> {

  const slug      = slugifyPresetName(name);
  const folder    = normalizePath(settings.presetsFolder);
  const filePath  = normalizePath(`${folder}/${slug}.json`);
  const existing  = app.vault.getFileByPath(filePath);

  // Build the preset — strip runtime-only fields from every block
  const preset: Preset = {
    name,
    description,
    createdAt: new Date().toISOString(),
    blocks: blocks.map(b => ({
      id:             b.id,
      operation:      b.operation,
      sourceType:     b.sourceType,
      sourcePath:     b.sourcePath,
      promptFile:     b.promptFile,
      injectPrevious: b.injectPrevious,
      destType:       b.destType,
      destPath:       b.destPath,
      destFilename:   b.destFilename,
      destOverwrite:  b.destOverwrite,
    })),
  };

  const json = JSON.stringify(preset, null, 2);

  await ensureFolder(app, folder);

  if (existing) {
    await app.vault.modify(existing, json);
  } else {
    await app.vault.create(filePath, json);
  }

  return { path: filePath, wasExisting: !!existing };
}


// ── Load all ──────────────────────────────────────
// Reads every .json file in the presetsFolder and parses them.
// Silently skips files that aren't valid presets.
// Returns presets sorted alphabetically by name.
export async function loadPresets(
  app:      App,
  settings: BusyGoblinsSettings,
): Promise<Array<Preset & { filePath: string }>> {

  const folder = app.vault.getFolderByPath(normalizePath(settings.presetsFolder));
  if (!folder) return [];

  const results: Array<Preset & { filePath: string }> = [];

  for (const child of folder.children) {
    // Only .json files
    if (!(child instanceof TFile) || child.extension !== 'json') continue;

    try {
      const raw  = await app.vault.read(child);
      const data = JSON.parse(raw) as Preset;

      // Must have a name and a blocks array
      if (!data.name || !Array.isArray(data.blocks)) continue;

      // Strip out any blocks whose operation isn't recognised.
      // This handles old presets from before a rename and crafted .json files.
      // We keep the rest of the preset rather than discarding it entirely.
      const validBlocks = data.blocks.filter(
        (b: unknown) =>
          typeof b === 'object' &&
          b !== null &&
          VALID_OPERATIONS.has((b as Record<string, unknown>).operation as string)
      );

      // Skip presets that have no usable blocks after filtering
      if (validBlocks.length === 0) continue;

      results.push({ ...data, blocks: validBlocks, filePath: child.path });
    } catch {
      // Corrupt or non-preset JSON — skip without crashing
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}


// ── Restore blocks from preset ────────────────────
// Adds back the runtime-only fields that were stripped on save.
// Returns a ChainBlock[] ready to hand to ChainManager.
export function blocksFromPreset(preset: Preset): ChainBlock[] {
  return preset.blocks.map(b => ({
    ...b,
    status:       'idle'  as const,
    output:       '',
    errorMessage: '',
  }));
}

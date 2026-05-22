// ══════════════════════════════════════════════════
// types.ts
// Every shared type definition for Busy Goblins.
//
// All other files import from here — define once,
// use everywhere, no drift between modules.
// ══════════════════════════════════════════════════


// ── Block Operation ───────────────────────────────
// The action a Block performs on its source.
//
//   process — reads source + applies prompt → LLM → writes to a NEW destination
//             (source file is untouched)
//   write   — applies prompt alone → LLM → writes to a new destination
//             (no source file needed)
//   rewrite — reads source + applies prompt → LLM → OVERWRITES the source file
//             (destination = source, no separate output)
//
// 'code' is intentionally absent — deferred to v2.
// See docs/adr/0001-drop-code-operation-v1.md
export type BlockOperation = 'process' | 'write' | 'rewrite';


// ── Source Type ───────────────────────────────────
// Where a Block reads its input content from.
//
//   file     — a single vault Markdown file
//   folder   — all .md files in a vault folder
//              (Inject/Write: concatenated into one call — see ADR 0002)
//              (Edit: each file processed individually  — see ADR 0004)
//   previous — the output string produced by the block directly above this one
//
// UI hiding rules (enforced in block-card.ts):
//   - 'previous' is hidden when the block is at position 1 (nothing precedes it)
//   - 'previous' is hidden when operation = 'edit' (no file path to overwrite)
export type SourceType = 'file' | 'folder' | 'previous';


// ── Destination Type ──────────────────────────────
// Where a Block writes its output.
//
//   file   — write to a specific named vault file
//   folder — write into a folder; filename uses destFilename with optional
//             timestamp suffix for versioning (see ADR 0005)
//   none   — no file written; output is only available as 'previous'
//             to the next block
//
// Edit blocks have no destination — they always overwrite their source.
// The destination section is hidden entirely in the UI for Edit blocks.
export type DestType = 'file' | 'folder' | 'none';


// ── Block Status ──────────────────────────────────
// Runtime state of a block during or after a chain run.
// NOT saved when the chain is saved as a Preset.
export type BlockStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';


// ── Chain Block ───────────────────────────────────
// The core object. A Chain is simply an array of these.
// The UI renders one card per block.
// The executor loops over this array and runs each block in order.
export interface ChainBlock {

  // ── Identity ──────────────────────────────────
  // id is a random string generated when the block is created.
  // It acts as a stable key for the UI and never changes,
  // even if the block is moved or edited.
  id: string;
  operation: BlockOperation;

  // ── Source ────────────────────────────────────
  // sourcePath is the vault-relative path to the file or folder.
  // It is an empty string when sourceType = 'previous' — no path is
  // needed because the executor pulls the string from the prior block's output.
  sourceType: SourceType;
  sourcePath: string;

  // ── Prompt File ───────────────────────────────
  // Always a vault .md file in v1.
  // The file body is used as the prompt text. YAML frontmatter is stripped
  // before sending to Ollama.
  //
  // The frontmatter can optionally specify a model override:
  //   ---
  //   model: qwen2.5:32b
  //   ---
  //
  // If no model is in the frontmatter, the plugin's defaultModel is used.
  // Inline prompt typing (no file needed) is a v2 feature.
  promptFile: string;

  // ── Inject Prior Output Into Prompt ───────────
  // When true, the output from the block above this one is automatically
  // prepended to the system prompt (the instructions sent to the LLM),
  // giving the model context about what the previous step produced.
  //
  // This is the UI-controlled alternative to writing {{previous}} inside
  // the prompt file itself. Both mechanisms work — this button is easier
  // to toggle without opening and editing the prompt file.
  //
  // Warning: if sourceType is also 'previous', the prior output will reach
  // the model twice — once in the instructions (system) and once in the
  // content (user). This works fine with larger models but may confuse
  // smaller ones. The block card shows a visible warning when both are active.
  injectPrevious: boolean;

  // ── Destination ───────────────────────────────
  // The entire destination section is hidden in the UI for Edit blocks.
  // Edit always overwrites its source file, so these fields are unused
  // for Edit — treat them as empty strings / false.
  destType: DestType;
  destPath: string;     // folder path for 'folder' dest; full file path for 'file' dest
  destFilename: string; // base filename without .md extension (used with 'folder' dest)

  // destOverwrite controls what happens when the destination file already exists.
  //
  // false (default — versioning mode):
  //   A timestamp suffix is appended to avoid overwriting: "summary-20260520-143022.md"
  //   The original file is never silently destroyed.
  //
  // true (opt-in — overwrite mode):
  //   The existing file is replaced. The user has explicitly granted permission
  //   to this block to overwrite.
  destOverwrite: boolean;

  // ── Runtime State ─────────────────────────────
  // Populated during a chain run, cleared when the chain resets.
  // STRIPPED when saving as a Preset — Presets are blueprints, not run logs.
  status: BlockStatus;
  output: string;       // result string — available as 'previous' to the next block
  errorMessage: string; // what went wrong if status = 'error'
}


// ── Preset ────────────────────────────────────────
// A saved, named snapshot of a chain configuration.
// Stored as one .json file per preset in the vault's presetsFolder.
//
// Runtime state is stripped — Presets are reusable blueprints,
// not records of past runs.
export interface Preset {
  name: string;        // user-given name, e.g. "Daily Show Notes Pipeline"
  description: string; // one-line summary shown in the preset picker modal
  createdAt: string;   // ISO date string
  blocks: Omit<ChainBlock, 'status' | 'output' | 'errorMessage'>[];
}


// ── Cancel Token ──────────────────────────────────
// WHY IS THIS AN OBJECT AND NOT A BOOLEAN?
//
// Primitive values (true/false) are COPIED when passed to a function.
// If you pass `cancelled = false` to a function, the function gets its own copy —
// setting cancelled = true later has no effect on that copy.
//
// Objects are passed BY REFERENCE — both sides point to the same thing:
//
//   const token = { cancelled: false };
//   executor.run(token);       // executor holds a reference to the SAME object
//   token.cancelled = true;    // executor sees this change immediately ✓
//
// This is the standard pattern for shared mutable state between
// async functions in TypeScript.
export interface CancelToken {
  cancelled: boolean;
}


// ── Plugin Settings ───────────────────────────────
// Persisted to disk via Plugin.loadData() / Plugin.saveData().
// Default values live in settings.ts — this interface defines the shape.
// ── API Model ─────────────────────────────────────
// One entry in the user's cloud cost comparison table.
// The list is fully editable — users can add, rename, reorder,
// and remove entries as the API landscape changes.
export interface ApiModel {
  name:       string; // display name, e.g. "Claude Haiku"
  inputRate:  number; // $ per million input tokens
  outputRate: number; // $ per million output tokens
}

export interface BusyGoblinsSettings {
  ollamaUrl:          string;     // Ollama server address, default "http://localhost:11434"
  defaultModel:       string;     // fallback model when prompt file has no model frontmatter
  presetsFolder:      string;     // vault-relative path where preset .json files are stored
  promptsFolder:      string;     // restrict prompt file picker to this folder; '' = whole vault
  protectedPaths:     string[];   // vault paths Busy Goblins will never overwrite
  showTokenCosts:     boolean;    // show estimated token usage + cloud cost after each run
  apiModels:          ApiModel[]; // user-editable list of cloud models + pricing
  tokenPricesUpdated: string;     // locale date string set when user edits prices; '' = never
}

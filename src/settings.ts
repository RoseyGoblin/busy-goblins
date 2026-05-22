// ══════════════════════════════════════════════════
// settings.ts
// Default values for plugin settings and per-model budgets.
//
// BusyGoblinsSettings defines what gets saved to disk.
// DEFAULT_SETTINGS is used on first install and as a fallback
// for any missing keys when merging saved data.
// ══════════════════════════════════════════════════

import { BusyGoblinsSettings, ApiModel } from './types';


// ── Default API model list ────────────────────────
// Approximate 2025/2026 rates in USD per million tokens.
// Users can edit names, rates, add new models, or remove ones
// they don't need — the list is fully customisable in Settings.
export const DEFAULT_API_MODELS: ApiModel[] = [
  { name: 'Claude Haiku',  inputRate: 0.80,  outputRate: 4.00  },
  { name: 'GPT-4o mini',   inputRate: 0.15,  outputRate: 0.60  },
  { name: 'Claude Sonnet', inputRate: 3.00,  outputRate: 15.00 },
  { name: 'GPT-4o',        inputRate: 5.00,  outputRate: 15.00 },
];

export const DEFAULT_SETTINGS: BusyGoblinsSettings = {
  ollamaUrl:          'http://localhost:11434',
  defaultModel:       'qwen2.5:32b',
  presetsFolder:      '_AI/BusyGoblins/Presets',
  promptsFolder:      '',
  protectedPaths:     [],
  showTokenCosts:     false,
  apiModels:          DEFAULT_API_MODELS.map(m => ({ ...m })),
  tokenPricesUpdated: '',
};


// ── Character Budgets ────────────────────────────
// How many characters of vault content to include in a single
// LLM call. This prevents sending more text than the model
// can fit in its context window.
//
// Rule of thumb: ~1 token per 4 characters of English text.
//
// llama3:70b  — 8,192 token total context.
//               ~800 tokens for the system prompt,
//               ~2,000 tokens headroom for the response.
//               Leaves ~5,400 tokens for content ≈ 21,600 chars.
//               We use 20,000 to stay comfortably under the ceiling.
//
// qwen2.5:32b — 128,000 token context window.
//               80,000 chars ≈ 20,000 tokens — well within limits.
//
// default     — conservative fallback for any model not in the table.
const CHAR_BUDGETS: Record<string, number> = {
  'llama3:70b':  20_000,
  'qwen2.5:32b': 80_000,
  'default':     16_000,
};

export function getBudget(model: string): number {
  return CHAR_BUDGETS[model] ?? CHAR_BUDGETS['default'];
}


// ── Context Window Sizes ─────────────────────────
const NUM_CTX: Record<string, number> = {
  'llama3:70b':  8_192,
  'qwen2.5:32b': 32_768,
  'default':     8_192,
};

export function getNumCtx(model: string): number {
  return NUM_CTX[model] ?? NUM_CTX['default'];
}

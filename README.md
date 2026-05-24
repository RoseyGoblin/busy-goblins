# Busy Goblins

Build reusable chains of AI operations on your Obsidian notes. Process, write, and rewrite Markdown files using a local [Ollama](https://ollama.com) model, then save your workflows as presets and run them in one click.

---

## What it does

Busy Goblins lets you wire together a sequence of AI steps — called a **chain** — where each step reads from a file or folder, runs it through a local language model with a prompt you provide, and writes the result somewhere. The output of one step can feed directly into the next.

A chain you build once can be saved as a **preset** and reused forever.

---

## Prerequisites

- [Ollama](https://ollama.com) installed and running locally (`ollama serve`)
- At least one model pulled, e.g. `ollama pull qwen2.5:32b`
- Obsidian desktop (plugin requires desktop — it uses Ollama's local API)

---

## Installation

### From the community store 

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for **Busy Goblins**
3. Install and enable

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/RoseyGoblin/busy-goblins/releases/latest)
2. Copy them into `.obsidian/plugins/busy-goblins/` inside your vault
3. Reload Obsidian and enable the plugin in Settings → Community plugins

---

## Setup

1. Open **Settings → Busy Goblins**
2. Set your **Ollama URL** (default `http://localhost:11434` is correct for most installs)
3. Set your **Default model** to whichever model you have pulled (e.g. `qwen2.5:32b`)
4. Optionally set a **Presets folder** where saved chains will be stored (default: `_AI/BusyGoblins/Presets`)

---

## How to use

### Open the panel

Click the chain icon in the ribbon, or run **Open panel** from the command palette.

### Build a chain

Each chain is made of one or more **blocks**. Click **+ Add Block** to add blocks and configure each one:

**Operation** — what the block does:
- **Process** — reads a source file or folder, sends it to the AI with your prompt, writes the response to a new destination. The source is never modified.
- **Write** — sends a prompt to the AI with no source file. Pure generation.
- **Rewrite** — reads a source file or folder, sends it to the AI with your prompt, and overwrites the source with the response. Destructive — use dry-run first.

**Source** — where the block reads from:
- **File** — a single Markdown file
- **Folder** — all Markdown files in a folder (combined into one context for Process/Write; processed individually for Rewrite)
- **Previous** — the output from the block above (available on Block 2 and later)

**Prompt file** — a Markdown file in your vault containing the instructions for the AI. Optionally add a `model:` key in the frontmatter to override the default model for that block:
```
---
model: llama3:70b
---
Summarise the following notes into bullet points...
```

**Destination** — where the output goes (Process and Write only):
- **File** — write to a specific file
- **Folder** — write into a folder with a base filename you provide. Adds a counter suffix if the file already exists (unless **Allow overwrite** is on)
- **None** — hold the output in memory only, passing it to the next block via **Previous**

### Run a chain

Click **Run**. Blocks execute top to bottom. The Run button is disabled with a tooltip explaining any missing configuration.

Click **Dry Run** first to preview exactly what the chain will read, which model it will call, and what it will write — without making any changes.

### Save and load presets

Click **Save Preset** to name and save the current chain as a `.json` file in your presets folder. Click **Load Preset** to browse and restore a saved chain.

---

## Settings reference

| Setting | Description |
|---------|-------------|
| Ollama URL | Address where Ollama is running. Default: `http://localhost:11434` |
| Default model | Fallback model when a prompt file has no `model:` frontmatter |
| Presets folder | Vault path where preset `.json` files are stored |
| Prompts folder | Restrict the prompt file picker to a specific folder. Leave blank to search the whole vault |
| Protected paths | Vault paths Busy Goblins will never overwrite. Rewrite blocks targeting these paths are blocked. Process/Write blocks with **Allow overwrite** enabled are also blocked |
| Show token cost estimate | After each run, show estimated token usage and approximate cloud API cost for comparison |

---

## Acknowledgements

Busy Goblins evolved from an earlier plugin by the same author called **The Director**, which handled single-agent folder runs. Busy Goblins is a ground-up rebuild with chaining, presets, and a broader set of operations.

The `FolderSuggest` component is adapted from [Synod](https://github.com/slaymish/Synod) by slaymish, used under MIT licence.

---

## Support

If you find Busy Goblins useful, you can [buy me a coffee](https://ko-fi.com/roseygoblin).

## Licence

MIT — see [LICENSE](LICENSE)

// ══════════════════════════════════════════════════
// main.ts
// Plugin entry point — the first file Obsidian loads.
//
// Obsidian calls onload() when the plugin is enabled.
// Obsidian calls onunload() when the plugin is disabled.
//
// This file is responsible for:
//   - Loading and saving settings
//   - Registering the side panel view
//   - Adding the ribbon icon and command palette entry
//   - Cancelling any in-progress run on unload
// ══════════════════════════════════════════════════

import { Plugin, PluginSettingTab, App, Setting } from 'obsidian';

import { BusyGoblinsSettings }            from './types';
import { DEFAULT_SETTINGS, DEFAULT_API_MODELS }  from './settings';
import { FolderSuggest }                  from './folder-suggest';
import { BusyGoblinsView, VIEW_TYPE }     from './view/panel';


// ══════════════════════════════════════════════════
// BusyGoblinsPlugin
// The main plugin class. Obsidian instantiates this on load.
// ══════════════════════════════════════════════════
export default class BusyGoblinsPlugin extends Plugin {

  settings: BusyGoblinsSettings = { ...DEFAULT_SETTINGS };

  async onload() {

    // ── Load settings ──────────────────────────
    // Object.assign merges saved values over defaults so any new
    // settings keys always get their defaults even if the saved
    // file predates the key being added.
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});

    // ── Restore apiModels array ────────────────
    // Object.assign is shallow so the apiModels array is already
    // replaced by the saved version if it exists. We just need to
    // handle two migration cases:
    //   1. Saved data has a valid apiModels array → already applied above
    //   2. Saved data has old tokenPrices object → convert to new format
    //   3. No saved data / empty array → defaults already applied
    if (saved?.tokenPrices && (!saved?.apiModels || !saved.apiModels.length)) {
      // Migrate from the old flat tokenPrices object format
      const p = saved.tokenPrices as Record<string, number>;
      this.settings.apiModels = [
        { name: 'Claude Haiku',  inputRate: p.claudeHaikuIn   ?? 0.80,  outputRate: p.claudeHaikuOut  ?? 4.00  },
        { name: 'GPT-4o mini',   inputRate: p.gpt4oMiniIn     ?? 0.15,  outputRate: p.gpt4oMiniOut    ?? 0.60  },
        { name: 'Claude Sonnet', inputRate: p.claudeSonnetIn  ?? 3.00,  outputRate: p.claudeSonnetOut ?? 15.00 },
        { name: 'GPT-4o',        inputRate: p.gpt4oIn         ?? 5.00,  outputRate: p.gpt4oOut        ?? 15.00 },
      ];
    } else if (!this.settings.apiModels?.length) {
      // No saved models at all — apply defaults
      this.settings.apiModels = DEFAULT_API_MODELS.map(m => ({ ...m }));
    }

    // ── Register the side panel view ───────────
    this.registerView(
      VIEW_TYPE,
      (leaf) => new BusyGoblinsView(leaf, this),
    );

    // ── Ribbon icon ────────────────────────────
    this.addRibbonIcon('link-2', 'Busy Goblins', () => {
      this.activateView();
    });

    // ── Command palette ────────────────────────
    // Note: do NOT include the plugin ID in the command id —
    // Obsidian prefixes it automatically. Just use a short descriptor.
    this.addCommand({
      id:       'open-panel',
      name:     'Open panel',
      callback: () => this.activateView(),
    });

    // ── Settings tab ───────────────────────────
    this.addSettingTab(new BusyGoblinsSettingsTab(this.app, this));
  }

  async onunload() {
    // Cancel any in-progress run so inject.ts doesn't try to
    // write to the vault after the plugin has been torn down.
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      const view = leaves[0].view as BusyGoblinsView;
      if (view?.cancelRun) view.cancelRun();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE);

    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      workspace.revealLeaf(leaf);
    }
  }
}


// ══════════════════════════════════════════════════
// BusyGoblinsSettingsTab
// The settings UI in Obsidian Settings → Busy Goblins.
//
// Compliance: no top-level heading. Section headings use
// setHeading() not createEl('h2').
// ══════════════════════════════════════════════════
class BusyGoblinsSettingsTab extends PluginSettingTab {

  plugin: BusyGoblinsPlugin;

  constructor(app: App, plugin: BusyGoblinsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Ollama URL')
      .setDesc('The address where Ollama is running. Default is localhost — change this only if Ollama runs on a different port or machine.')
      .addText(text => text
        .setPlaceholder('http://localhost:11434')
        .setValue(this.plugin.settings.ollamaUrl)
        .onChange(async (value) => {
          this.plugin.settings.ollamaUrl = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Default model')
      .setDesc('The Ollama model used when a prompt file does not specify one in its frontmatter. Must be pulled in Ollama first.')
      .addText(text => text
        .setPlaceholder('qwen2.5:32b')
        .setValue(this.plugin.settings.defaultModel)
        .onChange(async (value) => {
          this.plugin.settings.defaultModel = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Presets folder')
      .setDesc('Vault path where saved chain presets (.json files) are stored. Created automatically when you save your first preset.')
      .addText(text => {
        new FolderSuggest(this.app, text.inputEl);
        text
          .setPlaceholder('_AI/BusyGoblins/Presets')
          .setValue(this.plugin.settings.presetsFolder)
          .onChange(async (value) => {
            this.plugin.settings.presetsFolder = value.trim();
            await this.plugin.saveSettings();
          });
        return text;
      });

    new Setting(containerEl)
      .setName('Prompts folder')
      .setDesc('Restrict the prompt file picker to files inside this folder only. Useful if you keep all your prompt files in one place. Leave blank to search the entire vault.')
      .addText(text => {
        new FolderSuggest(this.app, text.inputEl);
        text
          .setPlaceholder('e.g. _AI/Prompts')
          .setValue(this.plugin.settings.promptsFolder)
          .onChange(async (value) => {
            this.plugin.settings.promptsFolder = value.trim();
            await this.plugin.saveSettings();
          });
        return text;
      });

    // ── Protected Paths ────────────────────────────
    // A list of vault paths that Busy Goblins will never overwrite.
    // Rewrite blocks are blocked entirely. Process/Write blocks with
    // "Allow overwrite" enabled are also blocked. Creating new files
    // inside protected folders is still allowed.
    new Setting(containerEl)
      .setName('Protected paths')
      .setDesc(
        'Vault paths Busy Goblins will never overwrite. ' +
        'Rewrite blocks targeting these paths are blocked outright. ' +
        'Process and Write blocks with "Allow overwrite" on are also blocked. ' +
        'Creating new files inside protected folders is still allowed.'
      );

    // Current paths list — rebuilt after every add/remove
    const protectedListEl = containerEl.createDiv({ cls: 'bg-protected-list' });

    const renderProtectedList = () => {
      protectedListEl.empty();
      const paths = this.plugin.settings.protectedPaths;

      if (paths.length === 0) {
        protectedListEl.createEl('p', {
          text: 'No protected paths — all vault content can be overwritten.',
          cls:  'bg-protected-empty',
        });
        return;
      }

      for (let idx = 0; idx < paths.length; idx++) {
        const row = protectedListEl.createDiv({ cls: 'bg-protected-row' });
        row.createSpan({ text: paths[idx], cls: 'bg-protected-path' });

        const removeBtn = row.createEl('button', { text: '✕', cls: 'bg-protected-remove-btn' });
        removeBtn.title = `Remove "${paths[idx]}" from protected paths`;
        removeBtn.addEventListener('click', async () => {
          this.plugin.settings.protectedPaths.splice(idx, 1);
          await this.plugin.saveSettings();
          renderProtectedList();
        });
      }
    };

    renderProtectedList();

    // Add path row — text input with folder autocomplete + Add button
    const addPathRow = containerEl.createDiv({ cls: 'bg-protected-add-row' });
    const addPathInput = addPathRow.createEl('input', {
      type: 'text',
      cls:  'bg-protected-input',
    });
    addPathInput.placeholder = 'e.g. Key-Documents';
    new FolderSuggest(this.app, addPathInput);

    const addPathBtn = addPathRow.createEl('button', {
      text: '+ Add',
      cls:  'bg-protected-add-btn',
    });

    const doAddPath = async () => {
      const value = addPathInput.value.trim();
      if (!value) return;
      // Silently ignore duplicates
      if (!this.plugin.settings.protectedPaths.includes(value)) {
        this.plugin.settings.protectedPaths.push(value);
        await this.plugin.saveSettings();
        renderProtectedList();
      }
      addPathInput.value = '';
    };

    addPathBtn.addEventListener('click', doAddPath);
    // Enter key in the input also triggers add
    addPathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void doAddPath(); }
    });

    new Setting(containerEl)
      .setName('Show token cost estimate after each run')
      .setDesc(
        'After a chain completes, show estimated token usage and approximate ' +
        'per-run cost for common cloud APIs. Uses ~1 token per 4 characters. ' +
        'Off by default. Update pricing below periodically — API prices change.'
      )
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showTokenCosts)
        .onChange(async (value) => {
          this.plugin.settings.showTokenCosts = value;
          await this.plugin.saveSettings();
        })
      );

    // ── API pricing collapsible section ────────────
    // A <details> element gives a native browser-collapsible section —
    // no JavaScript needed for the expand/collapse behaviour.
    // All model rows and the "add" button live inside it.
    const details = containerEl.createEl('details', { cls: 'bg-settings-details' });
    details.createEl('summary', {
      cls:  'bg-settings-summary',
      text: 'Cloud API pricing ($ per million tokens)',
    });
    details.createEl('p', {
      text: 'Add, rename, or remove models as the API landscape changes. ' +
            'Input and output rates are in USD per million tokens. ' +
            'Not updated automatically — check provider pages periodically.',
      cls:  'setting-item-description bg-settings-details-desc',
    });

    // Column header labels — wrapped in divs to match the row structure
    const header = details.createDiv({ cls: 'bg-model-row bg-model-header' });
    header.createDiv({ cls: 'bg-model-col-name' }).createSpan({ text: 'Model name' });
    header.createDiv({ cls: 'bg-model-col-rate' }).createSpan({ text: 'Input $/MTok' });
    header.createDiv({ cls: 'bg-model-col-rate' }).createSpan({ text: 'Output $/MTok' });
    header.createDiv({ cls: 'bg-model-col-remove' }); // spacer to align with ✕ column

    // Container for the dynamic model rows
    const rowsContainer = details.createDiv({ cls: 'bg-model-rows' });

    // Last-updated label (updated live without re-rendering)
    const updatedEl = details.createEl('p', {
      cls:  'bg-prices-updated',
      text: this.plugin.settings.tokenPricesUpdated
        ? `Prices last updated: ${this.plugin.settings.tokenPricesUpdated}`
        : 'Prices last updated: never — using default values',
    });

    // ── Stamp + save helper ───────────────────────
    const stampAndSave = async () => {
      this.plugin.settings.tokenPricesUpdated = new Date().toLocaleDateString();
      await this.plugin.saveSettings();
      updatedEl.setText(`Prices last updated: ${this.plugin.settings.tokenPricesUpdated}`);
    };

    // ── Row renderer ─────────────────────────────
    // Clears rowsContainer and rebuilds one row per model.
    // Called on initial render and after add/remove.
    const renderRows = () => {
      rowsContainer.empty();

      this.plugin.settings.apiModels.forEach((model, index) => {
        const row = rowsContainer.createDiv({ cls: 'bg-model-row' });

        // ── Each column is a wrapper div (column-sizing class) containing
        // the input (bg-model-input with width:100%). This prevents the
        // column-sizing and width:100% from fighting each other on the same element.

        // Model name
        const nameWrapper = row.createDiv({ cls: 'bg-model-col-name' });
        const nameInput   = nameWrapper.createEl('input', { type: 'text', cls: 'bg-model-input' });
        nameInput.value       = model.name;
        nameInput.placeholder = 'Model name';
        nameInput.addEventListener('blur', async () => {
          const v = nameInput.value.trim();
          if (v) {
            this.plugin.settings.apiModels[index].name = v;
            await stampAndSave();
          }
        });

        // Input rate
        const inWrapper = row.createDiv({ cls: 'bg-model-col-rate' });
        const inInput   = inWrapper.createEl('input', { type: 'number', cls: 'bg-model-input' });
        inInput.value = String(model.inputRate);
        inInput.step  = '0.01';
        inInput.min   = '0';
        inInput.addEventListener('blur', async () => {
          const n = parseFloat(inInput.value);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.apiModels[index].inputRate = n;
            await stampAndSave();
          }
        });

        // Output rate
        const outWrapper = row.createDiv({ cls: 'bg-model-col-rate' });
        const outInput   = outWrapper.createEl('input', { type: 'number', cls: 'bg-model-input' });
        outInput.value = String(model.outputRate);
        outInput.step  = '0.01';
        outInput.min   = '0';
        outInput.addEventListener('blur', async () => {
          const n = parseFloat(outInput.value);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.apiModels[index].outputRate = n;
            await stampAndSave();
          }
        });

        // Remove button — sits in its own fixed-width column
        const removeWrapper = row.createDiv({ cls: 'bg-model-col-remove' });
        const removeBtn = removeWrapper.createEl('button', { text: '✕', cls: 'bg-model-remove-btn' });
        removeBtn.disabled = this.plugin.settings.apiModels.length <= 1;
        removeBtn.title    = this.plugin.settings.apiModels.length <= 1
          ? 'At least one model is required'
          : 'Remove this model';
        removeBtn.addEventListener('click', async () => {
          if (this.plugin.settings.apiModels.length <= 1) return;
          this.plugin.settings.apiModels.splice(index, 1);
          await stampAndSave();
          renderRows();
        });
      });
    };

    renderRows();

    // Add model button
    const addBtn = details.createEl('button', {
      text: '+ Add model',
      cls:  'bg-model-add-btn',
    });
    addBtn.addEventListener('click', async () => {
      this.plugin.settings.apiModels.push({ name: 'New model', inputRate: 0, outputRate: 0 });
      await stampAndSave();
      renderRows();
    });

    new Setting(containerEl)
      .setName('Reset to defaults')
      .setDesc('Restore all settings to their original values. This does not delete any preset files.')
      .addButton(btn => btn
        .setButtonText('Reset')
        .setWarning()
        .onClick(async () => {
          Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
          await this.plugin.saveSettings();
          this.display();
        })
      );
  }
}

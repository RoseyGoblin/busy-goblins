// ══════════════════════════════════════════════════
// view/load-preset-modal.ts
// Browsable list of saved presets.
// The user picks one and confirms — the panel's chain
// is replaced with the preset's blocks.
// ══════════════════════════════════════════════════

import { App, Modal } from 'obsidian';
import { Preset, ChainBlock } from '../types';
import { blocksFromPreset } from '../presets';
import { ConfirmModal } from './confirm-modal';


export class LoadPresetModal extends Modal {

  // Full list of presets read from the presetsFolder
  private presets: Array<Preset & { filePath: string }>;

  // Called when the user selects a preset and confirms loading
  private onLoad: (blocks: ChainBlock[]) => void;

  constructor(
    app:     App,
    presets: Array<Preset & { filePath: string }>,
    onLoad:  (blocks: ChainBlock[]) => void,
  ) {
    super(app);
    this.presets = presets;
    this.onLoad  = onLoad;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Load Preset');

    if (this.presets.length === 0) {
      contentEl.createEl('p', {
        text: 'No presets saved yet. Build a chain and click Save Preset.',
        cls:  'bg-modal-empty',
      });
      return;
    }

    // One row per preset
    for (const preset of this.presets) {
      const row = contentEl.createDiv({ cls: 'bg-preset-row' });

      // ── Info ──────────────────────────────────
      const info = row.createDiv({ cls: 'bg-preset-info' });

      info.createEl('strong', { text: preset.name, cls: 'bg-preset-name' });

      if (preset.description) {
        info.createEl('p', {
          text: preset.description,
          cls:  'bg-preset-desc',
        });
      }

      const blockCount = preset.blocks.length;
      const date       = preset.createdAt
        ? new Date(preset.createdAt).toLocaleDateString()
        : 'unknown date';

      info.createEl('small', {
        text: `${blockCount} block${blockCount === 1 ? '' : 's'} · saved ${date}`,
        cls:  'bg-preset-meta',
      });

      // ── Load button ───────────────────────────
      const loadBtn = row.createEl('button', {
        text: 'Load',
        cls:  'bg-preset-load-btn mod-cta',
      });

      loadBtn.addEventListener('click', () => {
        // Use an Obsidian-native modal instead of confirm().
        // Native confirm() disrupts Obsidian's keyboard scope stack,
        // making text inputs in subsequently-opened modals non-typeable.
        new ConfirmModal(
          this.app,
          `Load "${preset.name}"?`,
          'This will replace your current chain. Any unsaved work will be lost.',
          () => {
            this.onLoad(blocksFromPreset(preset));
            this.close();
          },
          'Load',
        ).open();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

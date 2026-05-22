// ══════════════════════════════════════════════════
// view/save-preset-modal.ts
// Simple modal for entering a preset name + description
// before saving. Pops up when the user clicks Save Preset.
// ══════════════════════════════════════════════════

import { App, Modal } from 'obsidian';


export class SavePresetModal extends Modal {

  private onSave: (name: string, description: string) => void;

  constructor(app: App, onSave: (name: string, description: string) => void) {
    super(app);
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Save Preset');

    // ── Name field ─────────────────────────────
    contentEl.createEl('label', {
      text: 'Name',
      cls:  'bg-modal-label',
    });
    const nameInput = contentEl.createEl('input', {
      type: 'text',
      cls:  'bg-modal-input',
    });
    nameInput.placeholder = 'e.g. Daily Show Notes Pipeline';

    // ── Description field ──────────────────────
    contentEl.createEl('label', {
      text: 'Description (optional)',
      cls:  'bg-modal-label',
    });
    const descInput = contentEl.createEl('input', {
      type: 'text',
      cls:  'bg-modal-input',
    });
    descInput.placeholder = 'What does this chain do?';

    // ── Error area ─────────────────────────────
    const errorEl = contentEl.createEl('p', { cls: 'bg-modal-error' });
    errorEl.addClass('bg-hidden');

    // ── Buttons ────────────────────────────────
    const btnRow  = contentEl.createDiv({ cls: 'bg-modal-btn-row' });
    const saveBtn = btnRow.createEl('button', { text: 'Save', cls: 'mod-cta' });
    btnRow.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());

    // Save action — also triggered by Enter in the name field
    const doSave = () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.setText('A name is required.');
        errorEl.removeClass('bg-hidden');
        nameInput.focus();
        return;
      }
      this.onSave(name, descInput.value.trim());
      this.close();
    };

    saveBtn.addEventListener('click', doSave);
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSave();
    });

    // Focus the name field immediately when the modal opens
    setTimeout(() => nameInput.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

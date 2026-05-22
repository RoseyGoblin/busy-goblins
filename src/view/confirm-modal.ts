// ══════════════════════════════════════════════════
// view/confirm-modal.ts
// A reusable Obsidian-native confirmation dialog.
//
// WHY THIS EXISTS:
// Native browser confirm() disrupts Obsidian's keyboard
// scope stack on Electron. After the native dialog closes,
// text inputs in subsequently-opened Obsidian modals appear
// focused but don't accept keyboard input.
//
// This modal stays entirely within Obsidian's own scope
// system and avoids that bug entirely.
// ══════════════════════════════════════════════════

import { App, Modal } from 'obsidian';


export class ConfirmModal extends Modal {

  private titleText:   string;
  private message:     string;
  private confirmText: string;
  private onConfirm:   () => void;

  constructor(
    app:         App,
    title:       string,
    message:     string,
    onConfirm:   () => void,
    confirmText = 'Continue',
  ) {
    super(app);
    this.titleText   = title;
    this.message     = message;
    this.confirmText = confirmText;
    this.onConfirm   = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(this.titleText);

    contentEl.createEl('p', {
      text: this.message,
      cls:  'bg-confirm-message',
    });

    const btnRow     = contentEl.createDiv({ cls: 'bg-modal-btn-row' });
    const confirmBtn = btnRow.createEl('button', {
      text: this.confirmText,
      cls:  'mod-warning',
    });
    const cancelBtn  = btnRow.createEl('button', { text: 'Cancel' });

    confirmBtn.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

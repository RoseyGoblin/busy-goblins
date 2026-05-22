// ══════════════════════════════════════════════════
// view/block-card.ts
// The UI for a single Chain Block.
//
// Each BlockCard renders into a container element
// passed in by the panel. It owns its own DOM and
// calls onChange(updatedBlock) whenever any field changes.
//
// The panel holds the source-of-truth for each block's data
// (via ChainManager). The block card is just the UI surface —
// it reads from the block object and writes back through onChange.
//
// Milestone 3 additions:
//   - Remove button in header (disabled when only one block exists)
//   - 'previous' source type option (shown for blocks 2+)
//   - Status dot in header (idle / running / done / error / cancelled)
// ══════════════════════════════════════════════════

import { App, setTooltip } from 'obsidian';
import { ChainBlock, BlockStatus } from '../types';
import { FolderSuggest }           from '../folder-suggest';
import { FileSuggest }             from '../file-suggest';


export class BlockCard {

  private app:           App;
  private parent:        HTMLElement;
  private block:         ChainBlock;
  private index:         number;       // 0-based, displayed as "Block 1", "Block 2" …
  private canRemove:     boolean;      // false when this is the only block
  private showPrevious:  boolean;      // true for Block 2+ (something precedes them)
  private promptsFolder: string;       // '' = whole vault; non-empty = restrict prompt file picker
  private onChange:      (block: ChainBlock) => void;
  private onRemove:      () => void;

  // All AbstractInputSuggest instances created by this card.
  // Must be closed before the card's DOM is destroyed — if not, their
  // keyboard scopes stay registered and intercept events from subsequent
  // modals, making modal inputs appear visible but non-typeable.
  private suggests: { close(): void }[] = [];

  // DOM refs updated without a full re-render
  private statusDot:       HTMLElement | null = null;
  private sourceFileRow:   HTMLElement | null = null;
  private sourceFolderRow: HTMLElement | null = null;
  private sourcePrevRow:   HTMLElement | null = null;

  // Called by buildSourceSection whenever the source type changes,
  // so the inject-warning in buildPromptRow can update in sync.
  private _onSourceTypeChange: (() => void) | null = null;

  // Called when the operation changes to a type that needs different
  // sections visible. Panel implements this as renderBlockCards().
  private onRerender: (() => void) | null = null;

  constructor(
    app:           App,
    parent:        HTMLElement,
    block:         ChainBlock,
    index:         number,
    canRemove:     boolean,
    showPrevious:  boolean,
    promptsFolder: string,
    onChange:      (block: ChainBlock) => void,
    onRemove:      () => void,
    onRerender?:   () => void,
  ) {
    this.app           = app;
    this.parent        = parent;
    this.block         = block;
    this.index         = index;
    this.canRemove     = canRemove;
    this.showPrevious  = showPrevious;
    this.promptsFolder = promptsFolder;
    this.onChange      = onChange;
    this.onRemove      = onRemove;
    this.onRerender    = onRerender ?? null;
  }

  // ── destroy ──────────────────────────────────
  // Call before removing this card from the DOM.
  // Closes all suggest popovers so their keyboard scopes are
  // deregistered from Obsidian's scope stack. Without this, orphaned
  // scopes intercept keyboard events from subsequently opened modals.
  destroy(): void {
    for (const s of this.suggests) {
      try { s.close(); } catch { /* ignore if already closed */ }
    }
    this.suggests = [];
  }

  // ── render ───────────────────────────────────
  render(): void {
    const card = this.parent.createDiv({ cls: 'bg-block-card' });
    card.dataset.operation = this.block.operation;

    this.buildHeader(card);
    this.buildOperationRow(card);
    this.buildSourceSection(card);
    this.buildPromptRow(card);
    this.buildDestSection(card);
  }

  // ── updateStatus ─────────────────────────────
  // Updates just the status dot — called by the panel
  // during a run without needing a full re-render.
  updateStatus(status: BlockStatus): void {
    if (!this.statusDot) return;
    this.statusDot.className = `bg-status-dot bg-status-dot--${status}`;

    const labels: Record<BlockStatus, string> = {
      idle:      '●',
      running:   '●',
      done:      '●',
      error:     '●',
      cancelled: '●',
    };
    this.statusDot.setText(labels[status] ?? '●');

    const tips: Record<BlockStatus, string> = {
      idle:      'Idle — waiting to run',
      running:   'Running…',
      done:      'Done',
      error:     'Error — check status bar',
      cancelled: 'Cancelled',
    };
    setTooltip(this.statusDot, tips[status] ?? status);
  }

  // ── buildHeader ───────────────────────────────
  // "Block N" label + status dot on the left, badge + remove on the right.
  private buildHeader(card: HTMLElement): void {
    const header = card.createDiv({ cls: 'bg-block-header' });

    // Left side: status dot + block number
    const left = header.createDiv({ cls: 'bg-block-header-left' });

    this.statusDot = left.createSpan({ cls: 'bg-status-dot bg-status-dot--idle' });
    this.statusDot.setText('●');
    setTooltip(this.statusDot, 'Idle — waiting to run');

    left.createSpan({
      text: `Block ${this.index + 1}`,
      cls:  'bg-block-number',
    });

    // Right side: operation badge + remove button
    const right = header.createDiv({ cls: 'bg-block-header-right' });

    right.createSpan({
      text: this.block.operation.toUpperCase(),
      cls:  'bg-operation-badge',
    });

    const removeBtn = right.createEl('button', {
      text: '✕',
      cls:  'bg-remove-btn',
    });
    removeBtn.disabled = !this.canRemove;
    setTooltip(removeBtn,
      this.canRemove
        ? 'Remove this block from the chain.'
        : 'Cannot remove — the chain must have at least one block.'
    );
    removeBtn.addEventListener('click', () => {
      if (this.canRemove) this.onRemove();
    });
  }

  // ── buildOperationRow ─────────────────────────
  private buildOperationRow(card: HTMLElement): void {
    const row = card.createDiv({ cls: 'bg-field-row' });
    row.createEl('label', { text: 'Operation', cls: 'bg-field-label' });

    const select = row.createEl('select', { cls: 'bg-field-select' });
    setTooltip(select,
      'Prompt file = AI\'s instructions.  Source = the material it works on.\n\n' +
      'Process — source + prompt → AI → new file  (source untouched)\n' +
      'Write   — prompt alone   → AI → new file  (no source needed)\n' +
      'Rewrite — source + prompt → AI → source file overwritten'
    );

    select.createEl('option', { text: 'Process', value: 'process' });
    select.createEl('option', { text: 'Write',   value: 'write'   });
    select.createEl('option', { text: 'Rewrite', value: 'rewrite' });
    select.value = this.block.operation;

    select.addEventListener('change', () => {
      const prev = this.block.operation;
      this.block.operation = select.value as ChainBlock['operation'];

      // If switching to Rewrite and source was 'previous', reset it —
      // Rewrite needs a real file path to know what to overwrite.
      if (this.block.operation === 'rewrite' && this.block.sourceType === 'previous') {
        this.block.sourceType = 'file';
        this.block.sourcePath = '';
      }

      this.onChange({ ...this.block });

      // Re-render the whole card when the operation changes type,
      // because different operations show/hide different sections.
      // The data is already saved above so nothing is lost.
      if (prev !== this.block.operation) {
        this.onRerender?.();
      }
    });
  }

  // ── buildSourceSection ────────────────────────
  // File / Folder toggle (+ Previous for Block 2+) and path input.
  // Hidden entirely for Write (no source needed).
  // Shows an overwrite warning for Rewrite.
  private buildSourceSection(card: HTMLElement): void {
    const section = card.createDiv({ cls: 'bg-section' });

    // Write has no source — hide the entire section
    if (this.block.operation === 'write') section.addClass('bg-hidden');

    section.createDiv({ text: 'Source', cls: 'bg-section-label' });

    // ── Type toggle ───────────────────────────
    const typeRow = section.createDiv({ cls: 'bg-toggle-row' });

    const fileBtn   = typeRow.createEl('button', { text: 'File',   cls: 'bg-toggle-btn' });
    const folderBtn = typeRow.createEl('button', { text: 'Folder', cls: 'bg-toggle-btn' });

    setTooltip(fileBtn,   'Read one specific Markdown file and send it to the AI.');
    setTooltip(folderBtn, 'Read all Markdown files in a folder (combined into one context) and send them to the AI.');

    // 'Previous' button — shown for Block 2+, hidden for Rewrite
    // (Rewrite needs a real file path to know what to overwrite)
    let prevBtn: HTMLButtonElement | null = null;
    if (this.showPrevious && this.block.operation !== 'rewrite') {
      prevBtn = typeRow.createEl('button', { text: 'Previous', cls: 'bg-toggle-btn' });
      setTooltip(prevBtn,
        'Use the output from the block above this one as the source content.\n' +
        'You can also put {{previous}} anywhere in your prompt file to inject it there.'
      );
    }

    // Rewrite overwrite warning — shown below the source picker
    // so it's impossible to miss before hitting Run
    if (this.block.operation === 'rewrite') {
      const rewriteWarn = section.createDiv({ cls: 'bg-rewrite-warning' });
      rewriteWarn.setText(
        '⚠  This block will overwrite the source file(s) with the AI response. ' +
        'The original content will be replaced. Use dry-run to preview first.'
      );
    }

    // ── Path input rows ───────────────────────
    const fileRow = section.createDiv({ cls: 'bg-field-row' });
    this.sourceFileRow = fileRow;
    fileRow.createEl('label', { text: 'File path', cls: 'bg-field-label' });
    const fileInput = fileRow.createEl('input', { type: 'text', cls: 'bg-field-input' });
    fileInput.placeholder = 'e.g. Notes/my-note.md';
    fileInput.value = this.block.sourceType === 'file' ? this.block.sourcePath : '';
    this.suggests.push(new FileSuggest(this.app, fileInput));
    fileInput.addEventListener('blur', () => {
      this.block.sourcePath = fileInput.value.trim();
      this.onChange({ ...this.block });
    });

    const folderRow = section.createDiv({ cls: 'bg-field-row' });
    this.sourceFolderRow = folderRow;
    folderRow.createEl('label', { text: 'Folder path', cls: 'bg-field-label' });
    const folderInput = folderRow.createEl('input', { type: 'text', cls: 'bg-field-input' });
    folderInput.placeholder = 'e.g. Notes/ShowBible';
    folderInput.value = this.block.sourceType === 'folder' ? this.block.sourcePath : '';
    this.suggests.push(new FolderSuggest(this.app, folderInput));
    folderInput.addEventListener('blur', () => {
      this.block.sourcePath = folderInput.value.trim();
      this.onChange({ ...this.block });
    });

    // 'Previous' row — a simple info label, no path needed
    const prevRow = section.createDiv({ cls: 'bg-field-row bg-prev-row' });
    this.sourcePrevRow = prevRow;
    prevRow.createEl('small', {
      text: 'Output from the block above will be used as source content.',
      cls:  'bg-field-label',
    });

    // ── Toggle update logic ───────────────────
    const updateToggle = () => {
      const t = this.block.sourceType;
      fileBtn.classList.toggle('active',   t === 'file');
      folderBtn.classList.toggle('active', t === 'folder');
      if (prevBtn) prevBtn.classList.toggle('active', t === 'previous');

      this.sourceFileRow?.toggleClass('bg-hidden',   t !== 'file');
      this.sourceFolderRow?.toggleClass('bg-hidden', t !== 'folder');
      this.sourcePrevRow?.toggleClass('bg-hidden',   t !== 'previous');
    };

    fileBtn.addEventListener('click', () => {
      this.block.sourceType = 'file';
      updateToggle();
      this._onSourceTypeChange?.();
      this.onChange({ ...this.block });
    });
    folderBtn.addEventListener('click', () => {
      this.block.sourceType = 'folder';
      updateToggle();
      this._onSourceTypeChange?.();
      this.onChange({ ...this.block });
    });
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.block.sourceType = 'previous';
        updateToggle();
        this._onSourceTypeChange?.();
        this.onChange({ ...this.block });
      });
    }

    updateToggle();
  }

  // ── buildPromptRow ────────────────────────────
  private buildPromptRow(card: HTMLElement): void {
    const section = card.createDiv({ cls: 'bg-section' });
    section.createDiv({ text: 'Prompt', cls: 'bg-section-label' });

    // ── Prompt file picker ────────────────────
    const row = section.createDiv({ cls: 'bg-field-row' });
    row.createEl('label', { text: 'Prompt file', cls: 'bg-field-label' });

    const input = row.createEl('input', { type: 'text', cls: 'bg-field-input' });
    input.placeholder = 'e.g. _AI/Prompts/summarize.md';
    input.value = this.block.promptFile;
    setTooltip(input,
      'A vault Markdown file containing the instruction for the AI.\n' +
      'Add  model: qwen2.5:32b  in the frontmatter to override the default model.\n' +
      'You can also write {{previous}} anywhere in the file to place the prior\n' +
      'block\'s output at that exact spot in the instructions.'
    );
    // Pass promptsFolder so the picker only shows files inside the
    // designated prompts folder (if one is configured in Settings).
    // Empty string = search the whole vault (default behaviour).
    this.suggests.push(new FileSuggest(this.app, input, this.promptsFolder));
    input.addEventListener('blur', () => {
      this.block.promptFile = input.value.trim();
      this.onChange({ ...this.block });
    });

    // ── Inject prior output button ────────────
    // Only shown for Block 2+ — Block 1 has nothing before it.
    if (!this.showPrevious) return;

    const injectBtn = section.createEl('button', {
      text: 'Inject prior output into prompt',
      cls:  'bg-toggle-btn bg-inject-btn',
    });
    injectBtn.classList.toggle('active', this.block.injectPrevious);
    setTooltip(injectBtn,
      'Adds the prior block\'s output to the TOP of the AI\'s instructions.\n' +
      'To place it elsewhere, write {{previous}} in your prompt file instead.'
    );

    // ── Double-injection warning ──────────────
    // Shown when both this button AND Source = Previous are active.
    // The prior output would reach the model twice — once in the
    // instructions (system) and once in the content (user).
    const warning = section.createDiv({ cls: 'bg-inject-warning' });
    warning.setText(
      '⚠  Prior output is also your source — the model will receive it as both ' +
      'prompt context and content to work on. This works well with larger models ' +
      '(7B+) but may confuse smaller ones.'
    );

    // Show or hide the warning based on current state
    const updateWarning = () => {
      const bothActive = this.block.injectPrevious && this.block.sourceType === 'previous';
      warning.toggleClass('bg-hidden', !bothActive);
    };
    updateWarning();

    injectBtn.addEventListener('click', () => {
      this.block.injectPrevious = !this.block.injectPrevious;
      injectBtn.classList.toggle('active', this.block.injectPrevious);
      updateWarning();
      this.onChange({ ...this.block });
    });

    // Also update the warning whenever the source type changes.
    // We do this by hooking into the card's container and watching
    // for source toggle button clicks — but the cleanest way is to
    // expose an updateWarning call from the source section.
    // For now, we store the callback so buildSourceSection can call it.
    this._onSourceTypeChange = updateWarning;
  }


  // ── buildDestSection ──────────────────────────
  // Hidden for Rewrite — destination is always the source file.
  private buildDestSection(card: HTMLElement): void {
    const section = card.createDiv({ cls: 'bg-section' });

    // Rewrite overwrites its source — no separate destination needed
    if (this.block.operation === 'rewrite') {
      section.addClass('bg-hidden');
      return;
    }

    section.createDiv({ text: 'Destination', cls: 'bg-section-label' });

    const typeRow = section.createDiv({ cls: 'bg-toggle-row' });
    const fileBtn   = typeRow.createEl('button', { text: 'File',   cls: 'bg-toggle-btn' });
    const folderBtn = typeRow.createEl('button', { text: 'Folder', cls: 'bg-toggle-btn' });
    const noneBtn   = typeRow.createEl('button', { text: 'None',   cls: 'bg-toggle-btn' });

    setTooltip(fileBtn,   'Write output to a specific file. Enter the full vault path.');
    setTooltip(folderBtn, 'Write output into a folder. Enter the folder path and a base filename.');
    setTooltip(noneBtn,   'Do not write a file. Output is held in memory and available to the next block as "previous".');

    const fileSection   = section.createDiv({ cls: 'bg-dest-sub' });
    const folderSection = section.createDiv({ cls: 'bg-dest-sub' });
    const overwriteRow  = section.createDiv({ cls: 'bg-field-row bg-overwrite-row' });

    // File destination
    const fileRow = fileSection.createDiv({ cls: 'bg-field-row' });
    fileRow.createEl('label', { text: 'File path', cls: 'bg-field-label' });
    const fileInput = fileRow.createEl('input', { type: 'text', cls: 'bg-field-input' });
    fileInput.placeholder = 'e.g. Notes/Output/summary.md';
    fileInput.value = this.block.destType === 'file' ? this.block.destPath : '';
    fileInput.addEventListener('blur', () => {
      this.block.destPath = fileInput.value.trim();
      this.onChange({ ...this.block });
    });

    // Folder destination
    const destFolderRow = folderSection.createDiv({ cls: 'bg-field-row' });
    destFolderRow.createEl('label', { text: 'Folder path', cls: 'bg-field-label' });
    const destFolderInput = destFolderRow.createEl('input', { type: 'text', cls: 'bg-field-input' });
    destFolderInput.placeholder = 'e.g. Notes/Output';
    destFolderInput.value = this.block.destType === 'folder' ? this.block.destPath : '';
    this.suggests.push(new FolderSuggest(this.app, destFolderInput));
    destFolderInput.addEventListener('blur', () => {
      this.block.destPath = destFolderInput.value.trim();
      this.onChange({ ...this.block });
    });

    const filenameRow = folderSection.createDiv({ cls: 'bg-field-row' });
    filenameRow.createEl('label', { text: 'Filename', cls: 'bg-field-label' });
    const filenameInput = filenameRow.createEl('input', { type: 'text', cls: 'bg-field-input' });
    filenameInput.placeholder = 'e.g. summary (no .md needed)';
    filenameInput.value = this.block.destFilename;
    setTooltip(filenameInput,
      'Base filename without .md. If this file already exists and "Allow overwrite" is off, ' +
      'a counter suffix is added: summary-2.md, summary-3.md, etc.'
    );
    filenameInput.addEventListener('blur', () => {
      this.block.destFilename = filenameInput.value.trim();
      this.onChange({ ...this.block });
    });

    // Overwrite toggle
    const overwriteLabel = overwriteRow.createEl('label', { cls: 'bg-toggle-label' });
    const overwriteBox   = overwriteLabel.createEl('input', { type: 'checkbox' });
    overwriteBox.checked = this.block.destOverwrite;
    overwriteLabel.createSpan({ text: ' Allow overwrite' });
    setTooltip(overwriteRow,
      'Off (default): adds a counter suffix if the file exists (summary-2.md, summary-3.md…).\n' +
      'On: replaces the existing file.'
    );
    overwriteBox.addEventListener('change', () => {
      this.block.destOverwrite = overwriteBox.checked;
      this.onChange({ ...this.block });
    });

    // Toggle show/hide logic
    const updateDest = () => {
      const t = this.block.destType;
      fileBtn.classList.toggle('active',   t === 'file');
      folderBtn.classList.toggle('active', t === 'folder');
      noneBtn.classList.toggle('active',   t === 'none');
      fileSection.toggleClass('bg-hidden',   t !== 'file');
      folderSection.toggleClass('bg-hidden', t !== 'folder');
      overwriteRow.toggleClass('bg-hidden',  t === 'none');
    };

    fileBtn.addEventListener('click',   () => { this.block.destType = 'file';   updateDest(); this.onChange({ ...this.block }); });
    folderBtn.addEventListener('click', () => { this.block.destType = 'folder'; updateDest(); this.onChange({ ...this.block }); });
    noneBtn.addEventListener('click',   () => { this.block.destType = 'none';   updateDest(); this.onChange({ ...this.block }); });

    updateDest();
  }
}

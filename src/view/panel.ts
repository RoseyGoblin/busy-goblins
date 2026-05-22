// ══════════════════════════════════════════════════
// view/panel.ts
// The main Busy Goblins side panel.
//
// Milestone 5 additions:
//   - validateChain() wired to Run button disabled state
//   - Validation runs on panel open, block field blur, Ollama check
//   - Run button tooltip shows first validation issue
//   - Dry Run button: previews what the chain would do, no LLM calls
//   - Dry run output section shown below status area
// ══════════════════════════════════════════════════

import { ItemView, WorkspaceLeaf, setIcon, setTooltip } from 'obsidian';
import { CancelToken }          from '../types';
import { ChainManager }         from '../chain-manager';
import { runChain }             from '../chain-executor';
import { validateChain }        from '../validation';
import { dryRunChain }          from '../dry-run';
import { savePreset, loadPresets, blocksFromPreset } from '../presets';
import { SavePresetModal }      from './save-preset-modal';
import { LoadPresetModal }      from './load-preset-modal';
import { ConfirmModal }         from './confirm-modal';
import { BlockCard }            from './block-card';
import type BusyGoblinsPlugin   from '../main';


export const VIEW_TYPE = 'busy-goblins';


export class BusyGoblinsView extends ItemView {

  private plugin: BusyGoblinsPlugin;

  private chainManager: ChainManager;
  private isRunning       = false;
  private destroyed       = false;
  private cancelToken:    CancelToken = { cancelled: false };
  private blockCards:     BlockCard[] = [];

  // Tracks the last known Ollama reachability state.
  // Starts false — becomes true once checkOllama() succeeds.
  // runValidation() checks this alongside chain validity so the
  // Run button is disabled (with tooltip) when Ollama is down,
  // not just when the user clicks Run.
  private ollamaReachable = false;

  // ── DOM refs ──────────────────────────────────
  private ollamaStatusEl:  HTMLElement       | null = null;
  private chainContainer:  HTMLElement       | null = null;
  private runBtn:          HTMLButtonElement | null = null;
  private cancelBtn:       HTMLButtonElement | null = null;
  private dryRunBtn:       HTMLButtonElement | null = null;
  private statusEl:        HTMLElement       | null = null;
  private progressEl:      HTMLElement       | null = null;
  private tokenCountEl:    HTMLElement       | null = null;
  private dryRunSection:   HTMLElement       | null = null;
  private dryRunOutput:    HTMLElement       | null = null;
  private tokenSection:    HTMLElement       | null = null;
  private tokenOutput:     HTMLElement       | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: BusyGoblinsPlugin) {
    super(leaf);
    this.plugin       = plugin;
    this.chainManager = new ChainManager(() => this.onChainChanged());
  }

  getViewType()    { return VIEW_TYPE; }
  getDisplayText() { return 'Busy Goblins'; }
  getIcon()        { return 'link-2'; }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('busy-goblins-panel');

    this.buildOllamaStatus(root);
    this.buildChainContainer(root);
    this.buildAddBlockRow(root);
    this.buildPresetRow(root);
    this.buildRunRow(root);
    this.buildStatusArea(root);
    this.buildDryRunSection(root);
    this.buildTokenSection(root);

    this.renderBlockCards();
    // Ollama check also triggers validation after it resolves
    this.checkOllama().then(() => this.runValidation());
  }

  async onClose() {
    this.destroyed = true;
    this.cancelRun();
  }

  // ── onChainChanged ────────────────────────────
  // Called by ChainManager when blocks are added or removed.
  // Re-renders cards and re-runs validation.
  private onChainChanged(): void {
    this.renderBlockCards();
    this.runValidation();
  }

  // ── buildOllamaStatus ─────────────────────────
  private buildOllamaStatus(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'bg-status-bar' });
    this.ollamaStatusEl = bar.createSpan({
      cls:  'bg-ollama-status bg-ollama-checking',
      text: '● Checking Ollama...',
    });
  }

  // ── buildChainContainer ───────────────────────
  private buildChainContainer(root: HTMLElement): void {
    this.chainContainer = root.createDiv({ cls: 'bg-chain-container' });
  }

  // ── buildAddBlockRow ──────────────────────────
  private buildAddBlockRow(root: HTMLElement): void {
    const row    = root.createDiv({ cls: 'bg-add-row' });
    const addBtn = row.createEl('button', { cls: 'bg-add-btn' });
    setIcon(addBtn, 'plus');
    addBtn.createSpan({ text: ' Add Block' });
    setTooltip(addBtn, 'Add a new block to the end of the chain.');
    addBtn.addEventListener('click', () => {
      if (!this.isRunning) this.chainManager.addBlock();
    });
  }

  // ── buildPresetRow ────────────────────────────
  // Save Preset and Load Preset buttons, sitting between
  // the block list and the Run row.
  private buildPresetRow(root: HTMLElement): void {
    const row = root.createDiv({ cls: 'bg-preset-btn-row' });

    const saveBtn = row.createEl('button', { cls: 'bg-preset-action-btn' });
    setIcon(saveBtn, 'save');
    saveBtn.createSpan({ text: ' Save Preset' });
    setTooltip(saveBtn,
      'Save the current chain as a reusable preset. ' +
      'Presets are stored as .json files in your vault.'
    );
    saveBtn.addEventListener('click', () => this.onSavePreset());

    const loadBtn = row.createEl('button', { cls: 'bg-preset-action-btn' });
    setIcon(loadBtn, 'folder-open');
    loadBtn.createSpan({ text: ' Load Preset' });
    setTooltip(loadBtn,
      'Browse and load a saved preset. ' +
      'Loading replaces the current chain.'
    );
    loadBtn.addEventListener('click', () => this.onLoadPreset());
  }

  // ── onSavePreset ──────────────────────────────
  private async onSavePreset(): Promise<void> {
    new SavePresetModal(this.app, async (name, description) => {
      try {
        const { path, wasExisting } = await savePreset(
          name,
          description,
          this.chainManager.getBlocks(),
          this.app,
          this.plugin.settings,
        );

        if (wasExisting) {
          this.setStatus(`✓ Preset overwritten — saved to ${path}`);
        } else {
          this.setStatus(`✓ Preset saved — ${path}`);
        }
      } catch (err) {
        this.setStatus(`❌ Could not save preset: ${err instanceof Error ? err.message : String(err)}`);
      }
    }).open();
  }

  // ── onLoadPreset ──────────────────────────────
  private async onLoadPreset(): Promise<void> {
    this.setStatus('Reading presets...');

    let presets;
    try {
      presets = await loadPresets(this.app, this.plugin.settings);
    } catch (err) {
      this.setStatus(`❌ Could not read presets: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    this.setStatus('● Idle');

    new LoadPresetModal(this.app, presets, (blocks) => {
      // Replace the chain with the loaded blocks
      this.chainManager.setBlocks(blocks);
      this.setStatus('✓ Preset loaded.');
    }).open();
  }

  // ── buildRunRow ───────────────────────────────
  private buildRunRow(root: HTMLElement): void {
    const row = root.createDiv({ cls: 'bg-run-row' });

    this.runBtn = row.createEl('button', { cls: 'bg-run-btn' });
    setIcon(this.runBtn, 'play');
    this.runBtn.createSpan({ text: ' Run' });
    // Tooltip is updated dynamically by runValidation()
    this.runBtn.addEventListener('click', () => this.onRunClick());

    this.cancelBtn = row.createEl('button', { cls: 'bg-cancel-btn' });
    setIcon(this.cancelBtn, 'x');
    this.cancelBtn.createSpan({ text: ' Cancel' });
    setTooltip(this.cancelBtn,
      'Stop the chain after the current block finishes. Nothing further will be written.'
    );
    this.cancelBtn.disabled = true;
    this.cancelBtn.addEventListener('click', () => this.cancelRun());

    // Dry Run — always enabled, never touches files or calls APIs
    this.dryRunBtn = root.createEl('button', { cls: 'bg-dry-run-btn' });
    setIcon(this.dryRunBtn, 'eye');
    this.dryRunBtn.createSpan({ text: ' Dry Run' });
    setTooltip(this.dryRunBtn,
      'Preview what the chain would do — which files it would read, ' +
      'which models it would call, and what it would write — ' +
      'without making any changes.'
    );
    this.dryRunBtn.addEventListener('click', () => this.onDryRunClick());
  }

  // ── buildStatusArea ───────────────────────────
  private buildStatusArea(root: HTMLElement): void {
    root.createEl('hr', { cls: 'bg-divider' });

    this.statusEl = root.createEl('p', {
      cls:  'bg-status-text',
      text: '● Idle',
    });

    this.progressEl = root.createDiv({ cls: 'bg-progress' });
    this.progressEl.createDiv({ cls: 'bg-progress-fill' });

    this.tokenCountEl = root.createEl('p', { cls: 'bg-token-count' });
  }

  // ── buildDryRunSection ────────────────────────
  // Hidden by default. Appears after clicking Dry Run.
  private buildDryRunSection(root: HTMLElement): void {
    this.dryRunSection = root.createDiv({ cls: 'bg-dryrun-section' });
    this.dryRunSection.addClass('bg-hidden');

    // Header row with label and close button
    const header = this.dryRunSection.createDiv({ cls: 'bg-dryrun-header' });
    header.createSpan({ text: 'Dry Run Preview', cls: 'bg-dryrun-title' });
    const closeBtn = header.createEl('button', { cls: 'bg-dryrun-close', text: '✕' });
    setTooltip(closeBtn, 'Close dry run preview');
    closeBtn.addEventListener('click', () => {
      this.dryRunSection?.addClass('bg-hidden');
    });

    // Read-only output area
    this.dryRunOutput = this.dryRunSection.createEl('pre', { cls: 'bg-dryrun-output' });
  }

  // ── buildTokenSection ────────────────────────
  // Hidden until a chain run completes successfully.
  // Shows estimated token usage and approximate cloud API costs.
  private buildTokenSection(root: HTMLElement): void {
    this.tokenSection = root.createDiv({ cls: 'bg-token-section' });
    this.tokenSection.addClass('bg-hidden');
    this.tokenOutput = this.tokenSection.createEl('pre', { cls: 'bg-token-output' });
  }

  // Populates and shows the token cost section after a successful run.
  // inputChars — total characters sent to Ollama across all blocks
  // outputTokens — total tokens generated across all blocks
  private showTokenStats(inputChars: number, outputTokens: number): void {
    if (!this.tokenSection || !this.tokenOutput || this.destroyed) return;

    // Estimate input tokens using the ~1 token per 4 chars rule of thumb.
    // This is an approximation — actual tokenization varies by model
    // but is within ~10-20% for typical English text.
    const inputTokens = Math.round(inputChars / 4);
    const total       = inputTokens + outputTokens;

    // ── Cost table ──────────────────────────────
    // Uses the user's editable model list from settings.
    // Models can be added, renamed, or removed in Settings → Busy Goblins.
    const models = this.plugin.settings.apiModels ?? [];

    const costLine = (inputRate: number, outputRate: number): string => {
      const usd = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
      if (usd < 0.0005) return '<$0.001';
      if (usd < 0.01)   return `~$${usd.toFixed(3)}`;
      return `~$${usd.toFixed(2)}`;
    };

    const pad = (s: string, len: number) => s + ' '.repeat(Math.max(0, len - s.length));

    // Keep all lines short so they fit in a narrow sidebar without scrolling.
    // Each value gets its own line rather than cramming Input · Output · Total
    // onto one line that overflows at ~250px panel width.
    const lines: string[] = [
      `Tokens (estimated)`,
      `  Input   ~${inputTokens.toLocaleString()}`,
      `  Output   ${outputTokens.toLocaleString()}`,
      `  Total   ~${total.toLocaleString()}`,
      ``,
      `Cloud cost per run:`,
      ...models.map(m => `  ${pad(m.name, 15)} ${costLine(m.inputRate, m.outputRate)}`),
      ``,
      `* Approx — prices vary`,
      this.plugin.settings.tokenPricesUpdated
        ? `* Prices last updated: ${this.plugin.settings.tokenPricesUpdated}`
        : `* Prices last updated: never — update in Settings`,
    ];

    this.tokenOutput.setText(lines.join('\n'));
    this.tokenSection.removeClass('bg-hidden');
  }

  // ── renderBlockCards ──────────────────────────
  private renderBlockCards(): void {
    if (!this.chainContainer) return;
    // Destroy existing cards first so their FileSuggest/FolderSuggest
    // instances call close() and deregister from Obsidian's scope stack.
    // Without this, orphaned suggest scopes intercept keyboard events
    // from subsequently opened modals.
    for (const card of this.blockCards) card.destroy();
    this.chainContainer.empty();
    this.blockCards = [];

    const blocks = this.chainManager.getBlocks();
    const count  = this.chainManager.getCount();

    blocks.forEach((block, index) => {
      const container = this.chainContainer!.createDiv();
      const card = new BlockCard(
        this.app,
        container,
        block,
        index,
        count > 1,
        index > 0,
        this.plugin.settings.promptsFolder,
        (updatedBlock) => {
          this.chainManager.updateBlock(index, updatedBlock);
          // Re-validate whenever a field changes so Run button
          // enables/disables reactively as the user fills things in
          this.runValidation();
        },
        () => this.chainManager.removeBlock(index),
        () => this.renderBlockCards(),
      );
      card.render();
      this.blockCards.push(card);
    });
  }

  // ── runValidation ─────────────────────────────
  // Combines Ollama reachability + chain validity into one Run
  // button state. Ollama is checked first — if it's down, that's
  // the most urgent thing to fix and should be the tooltip message.
  // Called on: panel open, Ollama check, every block field blur.
  private runValidation(): void {
    if (!this.runBtn || this.destroyed) return;

    // Ollama unreachable takes priority — no point validating the
    // chain if the model can't be reached anyway.
    if (!this.ollamaReachable) {
      this.runBtn.disabled = true;
      setTooltip(this.runBtn, 'Ollama is not running — start it with: ollama serve');
      return;
    }

    const result = validateChain(
      this.chainManager.getBlocks(),
      this.app,
      this.plugin.settings,
    );

    if (result.valid) {
      this.runBtn.disabled = false;
      setTooltip(this.runBtn, 'Run the chain. All blocks execute in order, top to bottom.');
    } else {
      this.runBtn.disabled = true;
      setTooltip(this.runBtn, `Cannot run: ${result.firstIssue}`);
    }
  }

  // ── checkOllama ──────────────────────────────
  // Pings Ollama, updates the status indicator, stores the result
  // in this.ollamaReachable, and re-runs validation so the Run
  // button immediately reflects the new state.
  private async checkOllama(): Promise<boolean> {
    if (!this.ollamaStatusEl || this.destroyed) return false;

    try {
      const resp = await fetch(`${this.plugin.settings.ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      const ok = resp.ok;
      if (!this.destroyed && this.ollamaStatusEl) {
        this.ollamaStatusEl.setText(ok ? '● Ollama connected' : '● Ollama error');
        this.ollamaStatusEl.className = `bg-ollama-status ${ok ? 'bg-ollama-ok' : 'bg-ollama-error'}`;
      }
      this.ollamaReachable = ok;
      this.runValidation();
      return ok;
    } catch {
      if (!this.destroyed && this.ollamaStatusEl) {
        this.ollamaStatusEl.setText('● Ollama unreachable — run: ollama serve');
        this.ollamaStatusEl.className = 'bg-ollama-status bg-ollama-error';
      }
      this.ollamaReachable = false;
      this.runValidation();
      return false;
    }
  }

  // ── Helpers ───────────────────────────────────
  private setStatus(msg: string): void {
    if (this.destroyed || !this.statusEl) return;
    this.statusEl.setText(msg);
  }

  private setTokenCount(count: number): void {
    if (this.destroyed) return;
    if (count === 1) {
      this.progressEl?.addClass('active');
      this.tokenCountEl?.addClass('active');
    }
    if (this.tokenCountEl) {
      this.tokenCountEl.setText(`${count.toLocaleString()} tokens generated`);
    }
  }

  private hideProgress(): void {
    this.progressEl?.removeClass('active');
    this.tokenCountEl?.removeClass('active');
    if (this.tokenCountEl) this.tokenCountEl.setText('');
  }

  // ── onDryRunClick ─────────────────────────────
  private async onDryRunClick(): Promise<void> {
    if (!this.dryRunSection || !this.dryRunOutput) return;

    if (this.dryRunBtn) this.dryRunBtn.disabled = true;
    this.dryRunOutput.setText('Generating preview...');
    this.dryRunSection.removeClass('bg-hidden');

    try {
      const log = await dryRunChain(
        this.chainManager.getBlocks(),
        this.app,
        this.plugin.settings,
      );
      this.dryRunOutput.setText(log);
    } catch (err) {
      this.dryRunOutput.setText(`Error generating preview: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (this.dryRunBtn) this.dryRunBtn.disabled = false;
    }
  }

  // ── onRunClick ───────────────────────────────
  private async onRunClick(): Promise<void> {
    if (this.isRunning) return;

    // Run validation as a safety net — Run button should already
    // be disabled if invalid, but double-check before committing.
    const validation = validateChain(
      this.chainManager.getBlocks(),
      this.app,
      this.plugin.settings,
    );
    if (!validation.valid) {
      this.setStatus(`⚠ ${validation.firstIssue}`);
      return;
    }

    // Re-check Ollama immediately before the run
    this.setStatus('Checking Ollama...');
    const ollamaOk = await this.checkOllama();
    if (!ollamaOk) {
      this.setStatus('❌ Cannot reach Ollama. Make sure it is running: ollama serve');
      this.runValidation(); // update button state
      return;
    }

    // Last block no-destination confirmation
    const blocks    = this.chainManager.getBlocks();
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock.destType === 'none') {
      // Use an Obsidian-native modal instead of confirm().
      // Native confirm() disrupts Obsidian's keyboard scope stack,
      // making text inputs in subsequently-opened modals non-typeable.
      new ConfirmModal(
        this.app,
        'No destination on last block',
        'The last block has no destination — the output will not be saved. ' +
        'This is usually a configuration mistake. ' +
        'If you meant to save the result, cancel and set a destination first.',
        () => void this.doRun(),
        'Run anyway',
      ).open();
      return;
    }

    void this.doRun();
  }

  // ── doRun ────────────────────────────────────────
  // Executes the chain after all pre-flight checks pass.
  // Called directly from onRunClick(), or from the ConfirmModal
  // callback when the last block has no destination.
  private async doRun(): Promise<void> {
    // Guard — nothing should call this while a run is already in progress
    if (this.isRunning) return;

    // ── Lock UI ───────────────────────────────
    this.isRunning   = true;
    this.cancelToken = { cancelled: false };
    this.chainManager.resetRuntimeState();
    if (this.runBtn)    this.runBtn.disabled    = true;
    if (this.cancelBtn) this.cancelBtn.disabled = false;
    if (this.dryRunBtn) this.dryRunBtn.disabled = true;
    this.renderBlockCards();

    let seconds           = 0;
    let filesSkipped      = 0;
    let totalInputChars   = 0; // accumulated across all blocks for cost estimate
    let blockOutputTokens = 0; // running token count for the current block
    let totalOutputTokens = 0; // accumulated across all blocks

    // Hide stale token stats from a previous run
    this.tokenSection?.addClass('bg-hidden');

    const timer = window.setInterval(() => {
      if (this.destroyed) { window.clearInterval(timer); return; }
      seconds++;
    }, 1000);

    const total = this.chainManager.getCount();

    try {
      await runChain(
        this.app,
        this.chainManager.getBlocks(),
        this.plugin.settings,

        // onBlockStart — capture previous block's token count before resetting
        (index) => {
          totalOutputTokens += blockOutputTokens;
          blockOutputTokens  = 0;
          this.blockCards[index]?.updateStatus('running');
          this.setStatus(`Block ${index + 1} of ${total}: starting...`);
          seconds = 0;
        },

        (msg) => {
          if (msg.startsWith('⚠ Skipping')) filesSkipped++;
          const current = this.chainManager.getBlocks().findIndex(b => b.status === 'running');
          const label   = current >= 0 ? `Block ${current + 1} of ${total}: ` : '';
          this.setStatus(label + msg);
        },

        (index, status) => {
          this.blockCards[index]?.updateStatus(status);
        },

        this.cancelToken,

        // onToken — track per-block output tokens for cost accumulation
        (count) => {
          blockOutputTokens = count; // last value = total for this block
          this.setTokenCount(count);
        },

        // onInputChars — accumulate input chars across all blocks
        (chars) => { totalInputChars += chars; },
      );

      // Capture the last block's output token count
      totalOutputTokens += blockOutputTokens;

      if (this.cancelToken.cancelled) {
        this.setStatus('Cancelled.');
      } else {
        const blockWord = total === 1 ? 'block' : 'blocks';
        const skipNote  = filesSkipped > 0
          ? ` — ${filesSkipped} file${filesSkipped === 1 ? '' : 's'} skipped (too short to rewrite, check source folder)`
          : '';
        this.setStatus(`✓ Chain complete — ${total} ${blockWord} ran in ${seconds}s.${skipNote}`);

        // Show token usage and cloud cost estimates if the setting is on
        if (this.plugin.settings.showTokenCosts && (totalInputChars > 0 || totalOutputTokens > 0)) {
          this.showTokenStats(totalInputChars, totalOutputTokens);
        }
      }

    } catch (err) {
      this.setStatus(`❌ ${err instanceof Error ? err.message : String(err)}`);

    } finally {
      window.clearInterval(timer);
      this.hideProgress();
      this.isRunning = false;
      if (this.cancelBtn) this.cancelBtn.disabled = true;
      if (this.dryRunBtn) this.dryRunBtn.disabled = false;
      // Re-run validation to restore Run button state correctly
      this.runValidation();
    }
  }

  // ── cancelRun ────────────────────────────────
  public cancelRun(): void {
    if (!this.isRunning) return;
    this.cancelToken.cancelled = true;
    this.setStatus('Cancelling...');
  }
}

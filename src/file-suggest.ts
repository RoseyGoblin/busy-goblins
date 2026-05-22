/* File autocomplete for text inputs.
 *
 * Suggests vault .md files in a popover as the user types,
 * filtering to files whose path contains the query substring.
 * Selecting a suggestion writes the full vault-relative path
 * back into the input and fires an 'input' event so onChange
 * listeners pick it up.
 *
 * Modelled directly on folder-suggest.ts — same pattern,
 * TFile instead of TFolder.
 */

import { AbstractInputSuggest, App, TFile } from 'obsidian';

export class FileSuggest extends AbstractInputSuggest<TFile> {
  private inputEl:         HTMLInputElement;
  private restrictToFolder: string;

  // restrictToFolder — when non-empty, only files inside that vault folder
  // are shown. Empty string (default) searches the entire vault.
  constructor(app: App, inputEl: HTMLInputElement, restrictToFolder = '') {
    super(app, inputEl);
    this.inputEl          = inputEl;
    // Normalise once: lowercase, no trailing slash
    this.restrictToFolder = restrictToFolder.trim().toLowerCase().replace(/\/$/, '');
  }

  protected getSuggestions(query: string): TFile[] {
    const q      = query.toLowerCase();
    const folder = this.restrictToFolder;

    return this.app.vault
      .getMarkdownFiles()
      .filter(f => {
        const path = f.path.toLowerCase();
        // If a folder restriction is set, only include files whose path
        // starts with "folder/" — this matches files at any depth inside it.
        const inFolder = !folder || path.startsWith(folder + '/');
        return inFolder && path.includes(q);
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.inputEl.value = file.path;
    // Dispatch 'input' so any onChange handlers attached to this
    // input element fire — same behaviour as the user typing.
    this.inputEl.dispatchEvent(new Event('input'));
    this.close();
  }
}

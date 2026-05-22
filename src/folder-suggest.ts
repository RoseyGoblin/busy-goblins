/* Folder autocomplete for text inputs.
 *
 * Lists the vault's folders in a popover suggester so users don't have to
 * remember exact paths. Filters to folders whose path contains the query
 * substring (case-insensitive) and writes the selected path back into the
 * input, dispatching an `input` event so any onChange listeners fire.
 *
 * Copied verbatim from Synod (slaymish/Synod) — do not modify.
 */

import { AbstractInputSuggest, App, TFolder } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private inputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  protected getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getAllFolders(true)
      .filter((f) => f.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path === "" ? "/" : folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    const path = folder.path;
    this.inputEl.value = path;
    this.inputEl.dispatchEvent(new Event("input"));
    this.close();
  }
}

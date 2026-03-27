import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  getKeybindings,
  Input,
  Spacer,
  Text,
} from "@mariozechner/pi-tui";

import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";

export interface SearchableSelectOption {
  label: string;
  value: string;
  searchText?: string;
  detail?: string;
}

class SearchableSelectComponent extends Container {
  private readonly searchInput = new Input();
  private readonly listContainer = new Container();
  private readonly options: SearchableSelectOption[];
  private filteredOptions: SearchableSelectOption[];
  private selectedIndex = 0;
  private readonly onSelect: (value: string | undefined) => void;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    title: string,
    options: SearchableSelectOption[],
    onSelect: (value: string | undefined) => void,
  ) {
    super();
    this.options = options;
    this.filteredOptions = options;
    this.onSelect = onSelect;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(title, 0, 0));
    this.addChild(new Text("Type to search. Enter selects. Esc cancels.", 0, 0));
    this.addChild(new Spacer(1));
    this.searchInput.onSubmit = () => {
      const selected = this.filteredOptions[this.selectedIndex];
      this.onSelect(selected?.value);
    };
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());

    this.updateList();
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.up")) {
      if (this.filteredOptions.length === 0) {
        return;
      }
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filteredOptions.length - 1
          : this.selectedIndex - 1;
      this.updateList();
      return;
    }

    if (kb.matches(data, "tui.select.down")) {
      if (this.filteredOptions.length === 0) {
        return;
      }
      this.selectedIndex =
        this.selectedIndex === this.filteredOptions.length - 1
          ? 0
          : this.selectedIndex + 1;
      this.updateList();
      return;
    }

    if (kb.matches(data, "tui.select.confirm")) {
      const selected = this.filteredOptions[this.selectedIndex];
      this.onSelect(selected?.value);
      return;
    }

    if (kb.matches(data, "tui.select.cancel")) {
      this.onSelect(undefined);
      return;
    }

    this.searchInput.handleInput(data);
    this.filterOptions(this.searchInput.getValue());
  }

  private filterOptions(query: string): void {
    this.filteredOptions = query
      ? fuzzyFilter(
          this.options,
          query,
          (option) => option.searchText ?? option.label,
        )
      : this.options;
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredOptions.length - 1),
    );
    this.updateList();
  }

  private updateList(): void {
    this.listContainer.clear();

    if (this.filteredOptions.length === 0) {
      this.listContainer.addChild(new Text("  No matching results", 0, 0));
      return;
    }

    const maxVisible = 10;
    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(maxVisible / 2),
        this.filteredOptions.length - maxVisible,
      ),
    );
    const endIndex = Math.min(
      startIndex + maxVisible,
      this.filteredOptions.length,
    );

    for (let index = startIndex; index < endIndex; index += 1) {
      const option = this.filteredOptions[index];
      const prefix = index === this.selectedIndex ? "→ " : "  ";
      this.listContainer.addChild(
        new Text(`${prefix}${option.label}`, 0, 0),
      );
      if (option.detail) {
        this.listContainer.addChild(new Text(`    ${option.detail}`, 0, 0));
      }
    }

    if (startIndex > 0 || endIndex < this.filteredOptions.length) {
      this.listContainer.addChild(
        new Text(
          `  (${this.selectedIndex + 1}/${this.filteredOptions.length})`,
          0,
          0,
        ),
      );
    }
  }
}

export async function searchableSelect(
  ui: ExtensionUIContext,
  title: string,
  options: SearchableSelectOption[],
): Promise<string | undefined> {
  if (options.length === 0) {
    return undefined;
  }

  if (options.length <= 10) {
    const selected = await ui.select(
      title,
      options.map((option) => option.label),
    );
    return options.find((option) => option.label === selected)?.value;
  }

  const maybeCustom = ui as ExtensionUIContext & {
    custom?: ExtensionUIContext["custom"];
  };
  if (typeof maybeCustom.custom !== "function") {
    const selected = await ui.select(
      title,
      options.map((option) => option.label),
    );
    return options.find((option) => option.label === selected)?.value;
  }

  return maybeCustom.custom((tui, _theme, _keybindings, done) => {
    const component = new SearchableSelectComponent(title, options, done);
    return component;
  });
}

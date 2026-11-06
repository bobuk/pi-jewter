import {
  fuzzyFilter,
  Input,
  SelectList,
  truncateToWidth,
  wrapTextWithAnsi,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface PickItem {
  value: string;
  label?: string;
  description?: string;
}

export interface PickScope {
  id: string;
  label: string;
  items: PickItem[];
}

export interface PickOptions {
  /** Value marked as the current configuration in the list. */
  current?: string;
  /** Value highlighted when the picker opens (e.g. the item the user just came from). */
  initial?: string;
  /** Additional lists toggled with Tab, like the built-in model selector's scope. First one opens. */
  scopes?: PickScope[];
  /** Without scopes, Tab closes the picker and returns this value (e.g. to switch config scope). */
  tabResult?: string;
  /** Extra header line under the title. */
  subtitle?: string;
}

const MAX_VISIBLE = 12;
const NAVIGATION_KEYS = [
  "tui.select.up",
  "tui.select.down",
  "tui.select.pageUp",
  "tui.select.pageDown",
  "tui.select.confirm",
] as const;

function itemText(item: PickItem): string {
  return `${item.label ?? item.value} ${item.value} ${item.description ?? ""}`;
}

/** Sort like the built-in /model selector: current first, then provider, then id. */
export function sortModelItems(items: PickItem[], current?: string): PickItem[] {
  return [...items].sort((a, b) => {
    if (current) {
      if (a.value === current && b.value !== current) return -1;
      if (b.value === current && a.value !== current) return 1;
    }
    const slashA = a.value.indexOf("/");
    const slashB = b.value.indexOf("/");
    const providerA = slashA >= 0 ? a.value.slice(0, slashA) : "";
    const providerB = slashB >= 0 ? b.value.slice(0, slashB) : "";
    if (providerA !== providerB) return providerA.localeCompare(providerB);
    return a.value.localeCompare(b.value);
  });
}

function decorate(scopes: PickScope[], current?: string): PickScope[] {
  if (!current) return scopes;
  return scopes.map(scope => ({
    ...scope,
    items: scope.items.map(item =>
      item.value === current
        ? { ...item, description: [item.description, "current"].filter(Boolean).join(" · ") }
        : item,
    ),
  }));
}

/**
 * Fuzzy picker built on Pi's own TUI components, matching the built-in model
 * selector: type to filter, arrows to move, enter to select, Tab switches
 * scope. Esc clears a non-empty query first and cancels when it is empty.
 */
export async function pickWithSearch(
  ctx: ExtensionCommandContext,
  title: string,
  items: PickItem[],
  options: PickOptions = {},
): Promise<string | undefined> {
  if (!ctx.hasUI) return undefined;
  const scopes = decorate(options.scopes && options.scopes.length ? options.scopes : [{ id: "all", label: "all", items }], options.current);
  if (ctx.mode !== "tui") {
    const flat = scopes[0]!.items;
    const selected = await ctx.ui.select(title, flat.map(item => item.label ?? item.value));
    return flat.find(item => (item.label ?? item.value) === selected)?.value;
  }

  return ctx.ui.custom<string | undefined>(
    (tui, theme, keybindings, done) => {
      const search = new Input({ prompt: "› ", placeholder: "type to filter…" });
      const selectTheme: SelectListTheme = {
        selectedPrefix: text => theme.fg("accent", text),
        selectedText: text => theme.bold(text),
        description: text => theme.fg("dim", text),
        scrollInfo: text => theme.fg("dim", text),
        noMatch: text => theme.fg("dim", text),
      };
      let scopeIndex = 0;
      let query = "";
      let selectedValue = options.initial;
      let visible: PickItem[] = scopes[0]!.items;

      const buildList = (): SelectList => {
        const source = scopes[scopeIndex]!.items;
        const trimmed = query.trim();
        visible = trimmed ? fuzzyFilter(source, trimmed, itemText) : source;
        const list = new SelectList(
          visible.map(item => ({
            value: item.value,
            label: item.label ?? item.value,
            description: item.description,
          })),
          Math.min(Math.max(visible.length, 1), MAX_VISIBLE),
          selectTheme,
        );
        // Typing selects the best match; clearing restores the previous position.
        if (trimmed) list.setSelectedIndex(0);
        else if (selectedValue) {
          const index = visible.findIndex(item => item.value === selectedValue);
          if (index >= 0) list.setSelectedIndex(index);
        }
        list.onSelect = item => done(item.value);
        list.onCancel = () => done(undefined);
        list.onSelectionChange = item => { selectedValue = item.value; };
        return list;
      };

      let list = buildList();

      const refresh = (): void => {
        query = search.getValue();
        list = buildList();
        tui.requestRender();
      };

      return {
        get focused(): boolean {
          return search.focused;
        },
        set focused(value: boolean) {
          search.focused = value;
        },
        render(width: number): string[] {
          const scope = scopes[scopeIndex]!;
          const scopeHint = scopes.length > 1
            ? `${theme.fg("muted", "Scope: ")}${scopes.map((s, i) => (i === scopeIndex ? theme.fg("accent", s.label) : theme.fg("muted", s.label))).join(theme.fg("muted", " | "))} · ${theme.fg("muted", "tab")}`
            : undefined;
          const hint = `${visible.length}/${scope.items.length} shown · ↑↓ move · enter select · esc clear/cancel`;
          const selected = list.getSelectedItem();
          // Spell out full model refs (`provider/id`), which the list truncates; menu keys show their label.
          const shown = selected ? (selected.value.includes("/") ? selected.value : selected.label) : "";
          const full = selected
            ? wrapTextWithAnsi(theme.fg("accent", `selected: ${shown}`) + (selected.description ? theme.fg("dim", ` · ${selected.description}`) : ""), width)
            : [];
          return [
            theme.fg("accent", title),
            ...(options.subtitle ? [theme.fg("muted", options.subtitle)] : []),
            ...(scopeHint ? [scopeHint] : []),
            ...search.render(width),
            ...list.render(width),
            ...full,
            theme.fg("dim", hint),
          ].map(line => truncateToWidth(line, width));
        },
        handleInput(data: string): void {
          if (scopes.length <= 1 && options.tabResult !== undefined && keybindings.matches(data, "tui.input.tab")) {
            done(options.tabResult);
            return;
          }
          if (scopes.length > 1 && keybindings.matches(data, "tui.input.tab")) {
            scopeIndex = (scopeIndex + 1) % scopes.length;
            refresh();
            return;
          }
          if (keybindings.matches(data, "tui.select.cancel")) {
            if (search.getValue()) {
              search.setValue("");
              refresh();
            } else {
              done(undefined);
            }
            return;
          }
          if (NAVIGATION_KEYS.some(key => keybindings.matches(data, key))) {
            list.handleInput(data);
            return;
          }
          search.handleInput(data);
          if (search.getValue() !== query) refresh();
          else tui.requestRender();
        },
        invalidate(): void {
          search.invalidate();
          list.invalidate();
        },
      };
    },
    { blocked: { kind: "question", message: title } },
  );
}

/** Format a registry model as a picker item: id first, provider and capability badges after. */
export function modelItem(model: {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
}): PickItem {
  const bits: string[] = [`[${model.provider}]`];
  if (model.contextWindow && model.contextWindow > 0) bits.push(`${Math.round(model.contextWindow / 1000)}K ctx`);
  bits.push(model.reasoning ? "reasoning" : "no reasoning");
  return { value: `${model.provider}/${model.id}`, label: model.id, description: bits.join(" · ") };
}

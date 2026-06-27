export type SelectionKind = "tag" | "note" | "untagged-note";

export interface SelectionItem {
  key: string;
  kind: SelectionKind;
}

export interface SelectionState {
  selectedKeys: Set<string>;
  lastSelectedKey: string | null;
}

export interface SelectionClickOptions {
  shiftKey?: boolean;
  toggleKey?: boolean;
}

export function itemKindFromKey(key: string): SelectionKind {
  return key.split(":", 1)[0] as SelectionKind;
}

export function selectionKey(kind: SelectionKind, id: string, source?: string): string {
  return source ? `${kind}:${source}:${id}` : `${kind}:${id}`;
}

export function applySelectionClick(
  state: SelectionState,
  clicked: SelectionItem,
  visibleItems: SelectionItem[],
  options: SelectionClickOptions,
): SelectionState {
  if (options.shiftKey && state.lastSelectedKey) {
    const selectedKind = itemKindFromKey(state.lastSelectedKey);
    if (selectedKind !== clicked.kind) {
      return {
        selectedKeys: new Set([clicked.key]),
        lastSelectedKey: clicked.key,
      };
    }

    const rangeKeys = rangeBetween(visibleItems, state.lastSelectedKey, clicked.key, clicked.kind);
    if (rangeKeys.length > 0) {
      return {
        selectedKeys: new Set(rangeKeys),
        lastSelectedKey: clicked.key,
      };
    }
  }

  if (options.toggleKey) {
    const next = selectionContainsOnlyKind(state.selectedKeys, clicked.kind)
      ? new Set(state.selectedKeys)
      : new Set<string>();
    if (next.has(clicked.key)) {
      next.delete(clicked.key);
    } else {
      next.add(clicked.key);
    }
    return {
      selectedKeys: next,
      lastSelectedKey: clicked.key,
    };
  }

  return {
    selectedKeys: new Set([clicked.key]),
    lastSelectedKey: clicked.key,
  };
}

function rangeBetween(
  visibleItems: SelectionItem[],
  startKey: string,
  endKey: string,
  kind: SelectionKind,
): string[] {
  const start = visibleItems.findIndex((item) => item.key === startKey);
  const end = visibleItems.findIndex((item) => item.key === endKey);
  if (start === -1 || end === -1) {
    return [];
  }

  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return visibleItems
    .slice(from, to + 1)
    .filter((item) => item.kind === kind)
    .map((item) => item.key);
}

function selectionContainsOnlyKind(selectedKeys: Set<string>, kind: SelectionKind): boolean {
  for (const key of selectedKeys) {
    if (itemKindFromKey(key) !== kind) {
      return false;
    }
  }
  return true;
}

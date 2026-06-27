import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  applySelectionClick,
  selectionKey,
  type SelectionItem,
  type SelectionState,
} from "../src/selection";

const visible: SelectionItem[] = [
  { key: selectionKey("tag", "work"), kind: "tag" },
  { key: selectionKey("tag", "work/project"), kind: "tag" },
  { key: selectionKey("note", "A.md", "work/project"), kind: "note" },
  { key: selectionKey("note", "B.md", "work/project"), kind: "note" },
  { key: selectionKey("untagged-note", "C.md"), kind: "untagged-note" },
];

function emptyState(): SelectionState {
  return {
    selectedKeys: new Set(),
    lastSelectedKey: null,
  };
}

describe("selection reducer", () => {
  it("plain click selects only the clicked item", () => {
    const first = applySelectionClick(emptyState(), visible[0], visible, {});
    const second = applySelectionClick(first, visible[1], visible, {});

    assert.deepEqual(Array.from(second.selectedKeys), [visible[1].key]);
    assert.equal(second.lastSelectedKey, visible[1].key);
  });

  it("toggle click adds and removes same-kind items", () => {
    const first = applySelectionClick(emptyState(), visible[2], visible, {});
    const second = applySelectionClick(first, visible[3], visible, { toggleKey: true });
    const third = applySelectionClick(second, visible[2], visible, { toggleKey: true });

    assert.deepEqual(Array.from(second.selectedKeys).sort(), [visible[2].key, visible[3].key].sort());
    assert.deepEqual(Array.from(third.selectedKeys), [visible[3].key]);
  });

  it("shift click selects same-kind range", () => {
    const first = applySelectionClick(emptyState(), visible[2], visible, {});
    const second = applySelectionClick(first, visible[3], visible, { shiftKey: true });

    assert.deepEqual(Array.from(second.selectedKeys), [visible[2].key, visible[3].key]);
  });

  it("switching kind clears previous selection", () => {
    const first = applySelectionClick(emptyState(), visible[2], visible, {});
    const second = applySelectionClick(first, visible[0], visible, { toggleKey: true });

    assert.deepEqual(Array.from(second.selectedKeys), [visible[0].key]);
  });
});

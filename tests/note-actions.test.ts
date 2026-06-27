import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  buildRenameNoteTarget,
  noteKeyboardAction,
  notePayloadsFromSelection,
  shouldDeleteNotes,
  shouldStartRenameNote,
} from "../src/note-actions";
import type { SingleDragPayload } from "../src/drag-payload";

describe("note rename target", () => {
  it("builds a same-folder markdown path and preserves md extension", () => {
    assert.deepEqual(
      buildRenameNoteTarget("Folder/Old.md", "New.md", () => false),
      { ok: true, newPath: "Folder/New.md" },
    );
  });

  it("rejects empty names and path separators", () => {
    assert.deepEqual(buildRenameNoteTarget("Old.md", "   ", () => false), { ok: false, reason: "empty" });
    assert.deepEqual(buildRenameNoteTarget("Old.md", "A/B", () => false), { ok: false, reason: "separator" });
    assert.deepEqual(buildRenameNoteTarget("Old.md", "A\\B", () => false), { ok: false, reason: "separator" });
  });

  it("rejects existing target paths", () => {
    assert.deepEqual(
      buildRenameNoteTarget("Folder/Old.md", "Existing", (path) => path === "Folder/Existing.md"),
      { ok: false, reason: "exists", newPath: "Folder/Existing.md" },
    );
  });
});

describe("selected note payload helpers", () => {
  const note: SingleDragPayload = { type: "note", filePath: "A.md", sourceTag: "example/project" };
  const untagged: SingleDragPayload = { type: "untagged-note", filePath: "B.md" };
  const tag: SingleDragPayload = { type: "tag", path: "example/project" };

  it("extracts note and untagged-note payloads while ignoring tags", () => {
    assert.deepEqual(notePayloadsFromSelection([note, tag, undefined, untagged]), [note, untagged]);
  });

  it("starts rename only for a single note payload", () => {
    assert.equal(shouldStartRenameNote([note]), true);
    assert.equal(shouldStartRenameNote([untagged]), true);
    assert.equal(shouldStartRenameNote([note, untagged]), false);
    assert.equal(shouldStartRenameNote([tag]), false);
  });

  it("allows delete for one or more note payloads only", () => {
    assert.equal(shouldDeleteNotes([note]), true);
    assert.equal(shouldDeleteNotes([note, untagged]), true);
    assert.equal(shouldDeleteNotes([note, tag]), false);
    assert.equal(shouldDeleteNotes([]), false);
  });

  it("maps file-explorer-like keyboard shortcuts for selected notes", () => {
    assert.equal(noteKeyboardAction([note], { key: "Enter" }), "open");
    assert.equal(noteKeyboardAction([note], { key: "Enter", ctrlKey: true }), "open-new-tab");
    assert.equal(noteKeyboardAction([note], { key: "Enter", metaKey: true }), "open-new-tab");
    assert.equal(noteKeyboardAction([note], { key: "F2" }), "rename");
    assert.equal(noteKeyboardAction([note, untagged], { key: "F2" }), null);
    assert.equal(noteKeyboardAction([note, untagged], { key: "Delete" }), "delete");
    assert.equal(noteKeyboardAction([note, untagged], { key: "Backspace" }), "delete");
    assert.equal(noteKeyboardAction([tag], { key: "Delete" }), null);
  });
});

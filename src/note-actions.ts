import type { SingleDragPayload } from "./drag-payload";

export interface RenameNoteTargetResult {
  ok: boolean;
  reason?: "empty" | "separator" | "same" | "exists";
  newPath?: string;
}

export function buildRenameNoteTarget(
  oldPath: string,
  inputBaseName: string,
  exists: (path: string) => boolean,
): RenameNoteTargetResult {
  const cleanBaseName = inputBaseName.trim().replace(/\.md$/i, "");
  if (!cleanBaseName) {
    return { ok: false, reason: "empty" };
  }
  if (/[\\/]/.test(cleanBaseName)) {
    return { ok: false, reason: "separator" };
  }

  const parent = parentPath(oldPath);
  const newPath = parent ? `${parent}/${cleanBaseName}.md` : `${cleanBaseName}.md`;
  if (newPath.toLowerCase() === oldPath.toLowerCase()) {
    return { ok: false, reason: "same", newPath };
  }
  if (exists(newPath)) {
    return { ok: false, reason: "exists", newPath };
  }

  return { ok: true, newPath };
}

export function notePayloadsFromSelection(payloads: Array<SingleDragPayload | undefined>): SingleDragPayload[] {
  return payloads.filter((payload): payload is SingleDragPayload =>
    !!payload && (payload.type === "note" || payload.type === "untagged-note")
  );
}

export function shouldStartRenameNote(payloads: SingleDragPayload[]): boolean {
  return payloads.length === 1 && (payloads[0].type === "note" || payloads[0].type === "untagged-note");
}

export function shouldDeleteNotes(payloads: SingleDragPayload[]): boolean {
  return payloads.length > 0 && payloads.every((payload) => payload.type === "note" || payload.type === "untagged-note");
}

export type NoteKeyboardAction = "open" | "open-new-tab" | "rename" | "delete" | null;

export interface NoteKeyboardEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function noteKeyboardAction(
  payloads: SingleDragPayload[],
  event: NoteKeyboardEventLike,
): NoteKeyboardAction {
  if (event.key === "F2") {
    return shouldStartRenameNote(payloads) ? "rename" : null;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    return shouldDeleteNotes(payloads) ? "delete" : null;
  }
  if (event.key === "Enter" && shouldStartRenameNote(payloads)) {
    return event.ctrlKey || event.metaKey ? "open-new-tab" : "open";
  }
  return null;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

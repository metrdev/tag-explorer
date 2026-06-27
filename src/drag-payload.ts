export type SingleDragPayload =
  | { type: "tag"; path: string }
  | { type: "note"; filePath: string; sourceTag: string }
  | { type: "untagged-note"; filePath: string };

export type DragPayload = SingleDragPayload | { type: "batch"; items: SingleDragPayload[] };

export function resolveDragPayload(memoryPayload: DragPayload | null, rawPayload: string | null | undefined): DragPayload | null {
  return memoryPayload ?? parseDragPayload(rawPayload);
}

export function parseDragPayload(rawPayload: string | null | undefined): DragPayload | null {
  if (!rawPayload) {
    return null;
  }
  try {
    const payload = JSON.parse(rawPayload) as DragPayload;
    return isDragPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function isSingleDragPayload(payload: unknown): payload is SingleDragPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const value = payload as Record<string, unknown>;
  if (value.type === "tag") {
    return typeof value.path === "string";
  }
  if (value.type === "note") {
    return typeof value.filePath === "string" && typeof value.sourceTag === "string";
  }
  return value.type === "untagged-note" && typeof value.filePath === "string";
}

function isDragPayload(payload: unknown): payload is DragPayload {
  if (isSingleDragPayload(payload)) {
    return true;
  }
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const value = payload as Record<string, unknown>;
  return value.type === "batch"
    && Array.isArray(value.items)
    && value.items.every(isSingleDragPayload);
}

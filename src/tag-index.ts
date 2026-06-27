import type {
  CounterMode,
  IndexedNote,
  NoteSortMode,
  TagSortMode,
} from "./types";

export interface TagTreeOptions {
  counterMode: CounterMode;
  tagSort: TagSortMode;
  noteSort: NoteSortMode;
}

export interface TagTreeNode {
  name: string;
  path: string;
  children: TagTreeNode[];
  exactNotes: IndexedNote[];
  recursiveNotes: IndexedNote[];
  exactCount: number;
  recursiveCount: number;
  isTagFolder: boolean;
  hasRealTag: boolean;
  hasRealDescendant: boolean;
  hasNotes: boolean;
  tagFolderOnly: boolean;
}

export interface RenderableTagNode {
  node: TagTreeNode;
  notes: IndexedNote[];
  children: RenderableTagNode[];
}

interface MutableTagNode {
  name: string;
  path: string;
  children: Map<string, MutableTagNode>;
  exactNotes: Map<string, IndexedNote>;
  isTagFolder: boolean;
  hasRealTag: boolean;
}

export function normalizeTag(rawTag: unknown): string | null {
  if (typeof rawTag !== "string") {
    return null;
  }

  const trimmed = rawTag.trim().replace(/^#+/, "");
  const segments = trimmed
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.length > 0 ? segments.join("/") : null;
}

export function normalizeTags(rawTags: unknown[]): string[] {
  const normalized = new Set<string>();
  for (const rawTag of rawTags) {
    const tag = normalizeTag(rawTag);
    if (tag) {
      normalized.add(tag);
    }
  }
  return Array.from(normalized);
}

export function extractPropertyTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeTags(value);
  }

  const tag = normalizeTag(value);
  return tag ? [tag] : [];
}

export function createTagTree(
  notes: IndexedNote[],
  tagFolders: string[],
  options: TagTreeOptions,
): TagTreeNode {
  const root: MutableTagNode = {
    name: "",
    path: "",
    children: new Map(),
    exactNotes: new Map(),
    isTagFolder: false,
    hasRealTag: false,
  };

  for (const note of notes) {
    for (const tag of normalizeTags(note.tags)) {
      const node = ensurePath(root, tag);
      node.hasRealTag = true;
      node.exactNotes.set(note.path, note);
    }
  }

  for (const tagFolder of normalizeTags(tagFolders)) {
    ensurePath(root, tagFolder).isTagFolder = true;
  }

  const finalized = finalizeNode(root);
  sortTree(finalized, options);
  return finalized;
}

export function toRenderableTree(
  root: TagTreeNode,
  options: TagTreeOptions,
  filter: string,
): RenderableTagNode[] {
  const query = filter.trim().toLowerCase();
  return root.children
    .map((child) => toRenderableNode(child, options, query))
    .filter((child): child is RenderableTagNode => child !== null);
}

export function notesForNode(node: TagTreeNode): IndexedNote[] {
  return node.exactNotes;
}

export function countForNode(node: TagTreeNode, mode: CounterMode): number {
  return mode === "recursive" ? node.recursiveCount : node.exactCount;
}

export function canDeleteTagFolderSubtree(node: TagTreeNode): boolean {
  return node.isTagFolder && !node.hasRealTag && !node.hasRealDescendant && node.recursiveCount === 0;
}

export function sortNotes(notes: IndexedNote[], mode: NoteSortMode): IndexedNote[] {
  return [...notes].sort((left, right) => {
    switch (mode) {
      case "name-desc":
        return compareText(right.basename, left.basename) || compareText(right.path, left.path);
      case "modified-desc":
        return right.mtime - left.mtime || compareText(left.path, right.path);
      case "modified-asc":
        return left.mtime - right.mtime || compareText(left.path, right.path);
      case "path-asc":
        return compareText(left.path, right.path);
      case "name-asc":
      default:
        return compareText(left.basename, right.basename) || compareText(left.path, right.path);
    }
  });
}

function ensurePath(root: MutableTagNode, tagPath: string): MutableTagNode {
  let current = root;
  const segments = tagPath.split("/");
  const pathSegments: string[] = [];

  for (const segment of segments) {
    pathSegments.push(segment);
    const path = pathSegments.join("/");
    let child = current.children.get(segment);
    if (!child) {
      child = {
        name: segment,
        path,
        children: new Map(),
        exactNotes: new Map(),
        isTagFolder: false,
        hasRealTag: false,
      };
      current.children.set(segment, child);
    }
    current = child;
  }

  return current;
}

function finalizeNode(node: MutableTagNode): TagTreeNode {
  const children = Array.from(node.children.values()).map(finalizeNode);
  const recursiveNotes = new Map(node.exactNotes);
  let hasRealDescendant = false;

  for (const child of children) {
    for (const note of child.recursiveNotes) {
      recursiveNotes.set(note.path, note);
    }
    hasRealDescendant = hasRealDescendant || child.hasRealTag || child.hasRealDescendant;
  }

  const exactNotes = Array.from(node.exactNotes.values());
  const recursiveNoteValues = Array.from(recursiveNotes.values());

  return {
    name: node.name,
    path: node.path,
    children,
    exactNotes,
    recursiveNotes: recursiveNoteValues,
    exactCount: node.exactNotes.size,
    recursiveCount: recursiveNotes.size,
    isTagFolder: node.isTagFolder,
    hasRealTag: node.hasRealTag,
    hasRealDescendant,
    hasNotes: exactNotes.length > 0,
    tagFolderOnly: node.isTagFolder && !node.hasRealTag && !hasRealDescendant && recursiveNotes.size === 0,
  };
}

function sortTree(node: TagTreeNode, options: TagTreeOptions): void {
  node.exactNotes = sortNotes(node.exactNotes, options.noteSort);
  node.recursiveNotes = sortNotes(node.recursiveNotes, options.noteSort);

  node.children.sort((left, right) => {
    switch (options.tagSort) {
      case "name-desc":
        return compareText(right.name, left.name);
      case "count-desc":
        return countForNode(right, options.counterMode) - countForNode(left, options.counterMode)
          || compareText(left.name, right.name);
      case "count-asc":
        return countForNode(left, options.counterMode) - countForNode(right, options.counterMode)
          || compareText(left.name, right.name);
      case "name-asc":
      default:
        return compareText(left.name, right.name);
    }
  });

  for (const child of node.children) {
    sortTree(child, options);
  }
}

function toRenderableNode(
  node: TagTreeNode,
  options: TagTreeOptions,
  query: string,
): RenderableTagNode | null {
  const displayNotes = node.exactNotes;

  if (!query) {
    return {
      node,
      notes: displayNotes,
      children: node.children
        .map((child) => toRenderableNode(child, options, query))
        .filter((child): child is RenderableTagNode => child !== null),
    };
  }

  const tagMatches = includesQuery(node.name, query) || includesQuery(node.path, query);
  const matchingNotes = displayNotes.filter((note) =>
    includesQuery(note.basename, query) || includesQuery(note.path, query)
  );
  const matchingChildren = node.children
    .map((child) => toRenderableNode(child, options, query))
    .filter((child): child is RenderableTagNode => child !== null);

  if (!tagMatches && matchingNotes.length === 0 && matchingChildren.length === 0) {
    return null;
  }

  return {
    node,
    notes: tagMatches ? displayNotes : matchingNotes,
    children: matchingChildren,
  };
}

function includesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

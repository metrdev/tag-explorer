import type { Loc } from "obsidian";
import { normalizeTag, normalizeTags } from "./tag-index";

export interface InlineTagOccurrence {
  tag: string;
  position: {
    start: Loc;
    end: Loc;
  };
}

export interface TagOperationEntry {
  path: string;
  propertyCount: number;
  inlineCount: number;
}

export interface TagOperationPlan {
  titleLine?: string;
  oldPath: string;
  newPath: string;
  mode: "exact" | "subtree";
  entries: TagOperationEntry[];
  totalPropertyCount: number;
  totalInlineCount: number;
  tagFolderAdditions: string[];
  tagFolderRemovals: string[];
}

export interface PropertyRewriteResult {
  value: unknown;
  changed: boolean;
  count: number;
}

export interface InlineRewriteResult {
  content: string;
  count: number;
}

export function resolveRenameTarget(oldPath: string, input: string): string | null {
  const normalizedInput = normalizeTag(input);
  if (!normalizedInput) {
    return null;
  }

  if (normalizedInput.includes("/")) {
    return normalizedInput;
  }

  const parentPath = parentOfTag(oldPath);
  return parentPath ? `${parentPath}/${normalizedInput}` : normalizedInput;
}

export function resolveMoveTarget(oldPath: string, parentPath: string): string | null {
  const normalizedParent = normalizeTag(parentPath) ?? "";
  const name = nameOfTag(oldPath);
  const target = normalizedParent ? `${normalizedParent}/${name}` : name;

  if (target === oldPath || normalizedParent === oldPath || normalizedParent.startsWith(`${oldPath}/`)) {
    return null;
  }

  return target;
}

export function replaceSubtreeTagPath(tagPath: string, oldPath: string, newPath: string): string | null {
  if (tagPath === oldPath) {
    return newPath;
  }

  if (tagPath.startsWith(`${oldPath}/`)) {
    return `${newPath}${tagPath.slice(oldPath.length)}`;
  }

  return null;
}

export function replaceExactTagPath(tagPath: string, oldPath: string, newPath: string): string | null {
  return tagPath === oldPath ? newPath : null;
}

export function isInvalidMoveTarget(sourcePath: string, targetPath: string): boolean {
  return sourcePath === targetPath || targetPath.startsWith(`${sourcePath}/`);
}

export function countPropertyTagReplacements(
  value: unknown,
  oldPath: string,
  newPath: string,
  mode: TagOperationPlan["mode"] = "subtree",
): number {
  return rewritePropertyTags(value, oldPath, newPath, mode).count;
}

export function rewritePropertyTags(
  value: unknown,
  oldPath: string,
  newPath: string,
  mode: TagOperationPlan["mode"] = "subtree",
): PropertyRewriteResult {
  if (Array.isArray(value)) {
    const next: unknown[] = [];
    const seen = new Set<string>();
    let count = 0;
    let changed = false;

    for (const item of value) {
      if (typeof item !== "string") {
        next.push(item);
        continue;
      }

      const replacement = replaceRawTag(item, oldPath, newPath, mode);
      const nextItem = replacement ?? item;
      if (replacement) {
        count += 1;
        changed = true;
      }

      const normalized = normalizeTag(nextItem);
      if (normalized) {
        if (seen.has(normalized)) {
          changed = true;
          continue;
        }
        seen.add(normalized);
      }
      next.push(nextItem);
    }

    return { value: next, changed, count };
  }

  if (typeof value === "string") {
    const replacement = replaceRawTag(value, oldPath, newPath, mode);
    return replacement
      ? { value: replacement, changed: true, count: 1 }
      : { value, changed: false, count: 0 };
  }

  return { value, changed: false, count: 0 };
}

export function addPropertyTag(value: unknown, tagPath: string): PropertyRewriteResult {
  const normalized = normalizeTag(tagPath);
  if (!normalized) {
    return { value, changed: false, count: 0 };
  }

  if (Array.isArray(value)) {
    const existing = normalizeTags(value);
    if (existing.includes(normalized)) {
      return { value, changed: false, count: 0 };
    }
    return { value: [...normalizeTags(value), normalized], changed: true, count: 1 };
  }

  if (typeof value === "string") {
    const existing = normalizeTag(value);
    if (!existing) {
      return { value: normalized, changed: true, count: 1 };
    }
    if (existing === normalized) {
      return { value, changed: false, count: 0 };
    }
    return { value: [value, normalized], changed: true, count: 1 };
  }

  return { value: [normalized], changed: true, count: 1 };
}

export function removePropertyTag(value: unknown, tagPath: string): PropertyRewriteResult {
  const normalized = normalizeTag(tagPath);
  if (!normalized) {
    return { value, changed: false, count: 0 };
  }

  if (Array.isArray(value)) {
    let count = 0;
    const next = value.filter((item) => {
      if (typeof item === "string" && normalizeTag(item) === normalized) {
        count += 1;
        return false;
      }
      return true;
    });
    return count > 0 ? { value: next, changed: true, count } : { value, changed: false, count: 0 };
  }

  if (typeof value === "string" && normalizeTag(value) === normalized) {
    return { value: [], changed: true, count: 1 };
  }

  return { value, changed: false, count: 0 };
}

export function countInlineTagReplacements(
  tags: InlineTagOccurrence[],
  oldPath: string,
  newPath: string,
  frontmatterEndLine: number | null,
  mode: TagOperationPlan["mode"] = "subtree",
): number {
  return tags.filter((tag) => shouldReplaceInlineTag(tag, oldPath, newPath, frontmatterEndLine, mode)).length;
}

export function rewriteInlineTags(
  content: string,
  tags: InlineTagOccurrence[],
  oldPath: string,
  newPath: string,
  frontmatterEndLine: number | null,
  mode: TagOperationPlan["mode"] = "subtree",
): InlineRewriteResult {
  const lineOffsets = getLineOffsets(content);
  const replacements = tags
    .filter((tag) => shouldReplaceInlineTag(tag, oldPath, newPath, frontmatterEndLine, mode))
    .map((tag) => {
      const replaced = replaceTagPath(normalizeTag(tag.tag) ?? "", oldPath, newPath, mode);
      const start = offsetForLoc(lineOffsets, tag.position.start);
      const end = offsetForLoc(lineOffsets, tag.position.end);
      return replaced && start !== null && end !== null
        ? { start, end, from: tag.tag, to: `#${replaced}` }
        : null;
    })
    .filter((replacement): replacement is { start: number; end: number; from: string; to: string } =>
      replacement !== null && content.slice(replacement.start, replacement.end) === replacement.from
    )
    .sort((left, right) => right.start - left.start);

  let next = content;
  for (const replacement of replacements) {
    next = `${next.slice(0, replacement.start)}${replacement.to}${next.slice(replacement.end)}`;
  }

  return { content: next, count: replacements.length };
}

export function createOperationPlan(
  oldPath: string,
  newPath: string,
  mode: TagOperationPlan["mode"],
  entries: TagOperationEntry[],
  tagFolderAdditions: string[] = [],
  tagFolderRemovals: string[] = [],
  titleLine?: string,
): TagOperationPlan {
  return {
    titleLine,
    oldPath,
    newPath,
    mode,
    entries,
    totalPropertyCount: entries.reduce((sum, entry) => sum + entry.propertyCount, 0),
    totalInlineCount: entries.reduce((sum, entry) => sum + entry.inlineCount, 0),
    tagFolderAdditions,
    tagFolderRemovals,
  };
}

export function remapTagFolders(
  tagFolders: string[],
  oldPath: string,
  newPath: string,
  mode: TagOperationPlan["mode"] = "subtree",
): string[] {
  const next = new Set<string>();

  for (const folder of tagFolders) {
    const normalized = normalizeTag(folder);
    if (!normalized) {
      continue;
    }
    next.add(replaceTagPath(normalized, oldPath, newPath, mode) ?? normalized);
  }

  return Array.from(next).sort((left, right) => left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  }));
}

export function normalizeTagMoveSources(sourcePaths: string[]): string[] {
  const normalized = normalizeTags(sourcePaths).sort((left, right) => left.length - right.length);
  const result: string[] = [];
  for (const source of normalized) {
    if (!result.some((parent) => source.startsWith(`${parent}/`))) {
      result.push(source);
    }
  }
  return result;
}

export function parentOfTag(tagPath: string): string {
  const index = tagPath.lastIndexOf("/");
  return index === -1 ? "" : tagPath.slice(0, index);
}

export function nameOfTag(tagPath: string): string {
  const index = tagPath.lastIndexOf("/");
  return index === -1 ? tagPath : tagPath.slice(index + 1);
}

function replaceRawTag(
  rawTag: string,
  oldPath: string,
  newPath: string,
  mode: TagOperationPlan["mode"],
): string | null {
  const normalized = normalizeTag(rawTag);
  if (!normalized) {
    return null;
  }

  const replaced = replaceTagPath(normalized, oldPath, newPath, mode);
  if (!replaced) {
    return null;
  }

  return rawTag.trim().startsWith("#") ? `#${replaced}` : replaced;
}

function shouldReplaceInlineTag(
  tag: InlineTagOccurrence,
  oldPath: string,
  newPath: string,
  frontmatterEndLine: number | null,
  mode: TagOperationPlan["mode"],
): boolean {
  if (frontmatterEndLine !== null && tag.position.start.line <= frontmatterEndLine) {
    return false;
  }

  const normalized = normalizeTag(tag.tag);
  return normalized ? replaceTagPath(normalized, oldPath, newPath, mode) !== null : false;
}

function replaceTagPath(
  tagPath: string,
  oldPath: string,
  newPath: string,
  mode: TagOperationPlan["mode"],
): string | null {
  return mode === "exact"
    ? replaceExactTagPath(tagPath, oldPath, newPath)
    : replaceSubtreeTagPath(tagPath, oldPath, newPath);
}

function getLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function offsetForLoc(lineOffsets: number[], loc: Loc): number | null {
  if (typeof loc.offset === "number") {
    return loc.offset;
  }
  const lineOffset = lineOffsets[loc.line];
  return typeof lineOffset === "number" ? lineOffset + loc.col : null;
}

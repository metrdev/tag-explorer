import { normalizeTags } from "./tag-index";
import { DEFAULT_SETTINGS, type TagExplorerSettings } from "./types";

type LegacySettings = Partial<TagExplorerSettings> & {
  parentNotesMode?: unknown;
  virtualFolders?: unknown;
  tagFolders?: unknown;
};

export function normalizeSettingsData(loaded: unknown): TagExplorerSettings {
  const raw = isRecord(loaded) ? loaded as LegacySettings : {};
  const {
    parentNotesMode: _parentNotesMode,
    virtualFolders: _virtualFolders,
    tagFolders: _tagFolders,
    ...current
  } = raw;
  void _parentNotesMode;
  const tagFolderInput = [
    ...stringArray(_tagFolders),
    ...stringArray(_virtualFolders),
  ];

  return {
    ...DEFAULT_SETTINGS,
    ...current,
    showUntaggedSection: typeof raw.showUntaggedSection === "boolean"
      ? raw.showUntaggedSection
      : DEFAULT_SETTINGS.showUntaggedSection,
    expandedTags: stringArray(raw.expandedTags),
    tagFolders: normalizeTags(tagFolderInput),
    excludedNotePaths: normalizeNotePaths(stringArray(raw.excludedNotePaths)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeNotePaths(paths: string[]): string[] {
  const normalized = new Set<string>();
  for (const path of paths) {
    const clean = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (clean.length > 0) {
      normalized.add(clean);
    }
  }
  return Array.from(normalized).sort((left, right) => left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  }));
}

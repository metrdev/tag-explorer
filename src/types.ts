import type { TFile } from "obsidian";

export const VIEW_TYPE_TAG_EXPLORER = "tag-explorer-view";

export type TagSourceMode = "all-tags" | "properties-only";
export type CounterMode = "exact" | "recursive";
export type TagSortMode = "name-asc" | "name-desc" | "count-desc" | "count-asc";
export type NoteSortMode = "name-asc" | "name-desc" | "modified-desc" | "modified-asc" | "path-asc";

export interface TagExplorerSettings {
  tagSourceMode: TagSourceMode;
  counterMode: CounterMode;
  tagSort: TagSortMode;
  noteSort: NoteSortMode;
  showNoteFileExtension: boolean;
  showFullPathOnHover: boolean;
  showUntaggedSection: boolean;
  persistExpandedTags: boolean;
  expandedTags: string[];
  tagFolders: string[];
  excludedNotePaths: string[];
  experimentalOpenSearch: boolean;
}

export const DEFAULT_SETTINGS: TagExplorerSettings = {
  tagSourceMode: "all-tags",
  counterMode: "recursive",
  tagSort: "name-asc",
  noteSort: "name-asc",
  showNoteFileExtension: false,
  showFullPathOnHover: true,
  showUntaggedSection: true,
  persistExpandedTags: false,
  expandedTags: [],
  tagFolders: [],
  excludedNotePaths: [],
  experimentalOpenSearch: false,
};

export interface IndexedNote {
  path: string;
  basename: string;
  extension: string;
  mtime: number;
  file?: TFile;
  tags: string[];
}

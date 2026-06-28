import {
  addIcon,
  getLanguage,
  getAllTags,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  type CachedMetadata,
  type TagCache,
  type WorkspaceLeaf,
} from "obsidian";
import { confirmVariantForAction } from "./confirm-variant";
import { TAG_EXPLORER_ICON_ID, TAG_EXPLORER_ICON_SVG } from "./icons";
import { chooseParentTag, confirmDeleteNotes, confirmTagOperation, promptForText } from "./modals";
import { t, setLanguage } from "./i18n";
import { buildRenameNoteTarget } from "./note-actions";
import { shouldConfirmOperation, type OperationOptions } from "./operation-confirmation";
import { TagExplorerSettingTab } from "./settings-tab";
import {
  canDeleteTagFolderSubtree,
  createTagTree,
  extractPropertyTags,
  normalizeTag,
  normalizeTags,
  type TagTreeNode,
} from "./tag-index";
import {
  addPropertyTag,
  countInlineTagReplacements,
  countPropertyTagReplacements,
  createOperationPlan,
  isInvalidMoveTarget,
  nameOfTag,
  normalizeTagMoveSources,
  remapTagFolders,
  resolveMoveTarget,
  resolveRenameTarget,
  removePropertyTag,
  rewriteInlineTags,
  rewritePropertyTags,
  type InlineTagOccurrence,
  type TagOperationEntry,
  type TagOperationPlan,
} from "./tag-operations";
import { normalizeNotePaths, normalizeSettingsData } from "./settings";
import { TagExplorerView } from "./view";
import {
  DEFAULT_SETTINGS,
  VIEW_TYPE_TAG_EXPLORER,
  type IndexedNote,
  type TagExplorerSettings,
} from "./types";

type UndoOperation =
  | { type: "tag"; plans: TagOperationPlan[] }
  | { type: "untagged-add"; targetTag: string; entries: TagOperationEntry[] };

interface TagFrontmatter {
  tags?: unknown;
}

interface OperationStats {
  changedFiles: number;
  propertyCount: number;
  inlineCount: number;
}

export default class TagExplorerPlugin extends Plugin {
  settings: TagExplorerSettings = { ...DEFAULT_SETTINGS };
  expandedTags = new Set<string>();
  private rebuildTimer: number | null = null;
  private lastOperation: UndoOperation | null = null;

  async onload(): Promise<void> {
    setLanguage(getLanguage());
    addIcon(TAG_EXPLORER_ICON_ID, TAG_EXPLORER_ICON_SVG);
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_TAG_EXPLORER,
      (leaf: WorkspaceLeaf) => new TagExplorerView(leaf, this),
    );

    this.addRibbonIcon(TAG_EXPLORER_ICON_ID, t("command.open"), () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open",
      name: t("command.open"),
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new TagExplorerSettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on("changed", () => this.queueRebuild()));
    this.registerEvent(this.app.metadataCache.on("deleted", () => this.queueRebuild()));
    this.registerEvent(this.app.vault.on("create", () => this.queueRebuild()));
    this.registerEvent(this.app.vault.on("delete", () => this.queueRebuild()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void this.handleVaultRename(file, oldPath);
      this.queueRebuild();
    }));
    this.registerEvent(this.app.vault.on("modify", () => this.queueRebuild()));
  }

  async activateView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TAG_EXPLORER).first();
    if (existingLeaf) {
      await this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_TAG_EXPLORER, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  getIndexedNotes(): IndexedNote[] {
    const notes: IndexedNote[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isNoteExcluded(file.path)) {
        continue;
      }
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = this.tagsForFile(cache);
      if (tags.length === 0) {
        continue;
      }

      notes.push({
        path: file.path,
        basename: file.basename,
        extension: file.extension,
        mtime: file.stat.mtime,
        file,
        tags,
      });
    }

    return notes;
  }

  getUntaggedNotes(): IndexedNote[] {
    const notes: IndexedNote[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isNoteExcluded(file.path)) {
        continue;
      }
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = this.tagsForFile(cache);
      if (tags.length > 0) {
        continue;
      }

      notes.push({
        path: file.path,
        basename: file.basename,
        extension: file.extension,
        mtime: file.stat.mtime,
        file,
        tags: [],
      });
    }

    return notes.sort((left, right) =>
      left.basename.localeCompare(right.basename, undefined, { sensitivity: "base", numeric: true })
      || left.path.localeCompare(right.path, undefined, { sensitivity: "base", numeric: true })
    );
  }

  rebuildViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TAG_EXPLORER)) {
      if (leaf.view instanceof TagExplorerView) {
        leaf.view.render();
      }
    }
  }

  queueRebuild(): void {
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
    }

    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuildViews();
    }, 150);
  }

  async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    this.settings = normalizeSettingsData(loaded);
    this.expandedTags = new Set(this.settings.persistExpandedTags ? this.settings.expandedTags : []);
  }

  async saveSettings(): Promise<void> {
    this.settings.expandedTags = this.settings.persistExpandedTags ? Array.from(this.expandedTags).sort() : [];
    this.settings.tagFolders = normalizeTags(this.settings.tagFolders);
    this.settings.excludedNotePaths = normalizeNotePaths(this.settings.excludedNotePaths);
    await this.saveData(this.settings);
  }

  async saveSettingsAndRefresh(): Promise<void> {
    await this.saveSettings();
    this.rebuildViews();
  }

  async persistExpandedTags(): Promise<void> {
    if (this.settings.persistExpandedTags) {
      await this.saveSettings();
    }
  }

  expandRecursively(tagPath: string): void {
    const root = this.createCurrentTagTree();

    const stack = [...root.children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (node.path === tagPath || node.path.startsWith(`${tagPath}/`)) {
        this.expandedTags.add(node.path);
      }
      stack.push(...node.children);
    }
  }

  expandAll(): void {
    const root = this.createCurrentTagTree();
    const stack = [...root.children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      this.expandedTags.add(node.path);
      stack.push(...node.children);
    }
  }

  collapseAll(): void {
    this.expandedTags.clear();
  }

  collapseRecursively(tagPath: string): void {
    for (const expandedTag of Array.from(this.expandedTags)) {
      if (expandedTag === tagPath || expandedTag.startsWith(`${tagPath}/`)) {
        this.expandedTags.delete(expandedTag);
      }
    }
  }

  getAllTagPaths(): string[] {
    const tags = new Set<string>();
    for (const note of this.getIndexedNotes()) {
      for (const tag of note.tags) {
        tags.add(tag);
      }
    }
    for (const tagFolder of this.settings.tagFolders) {
      tags.add(tagFolder);
    }
    return Array.from(tags).sort((left, right) => left.localeCompare(right, undefined, {
      sensitivity: "base",
      numeric: true,
    }));
  }

  hasUndoOperation(): boolean {
    return this.lastOperation !== null;
  }

  isNoteExcluded(filePath: string): boolean {
    return this.settings.excludedNotePaths.includes(filePath);
  }

  async excludeNotes(filePaths: string[]): Promise<void> {
    const next = normalizeNotePaths([...this.settings.excludedNotePaths, ...filePaths]);
    const addedCount = next.length - this.settings.excludedNotePaths.length;
    if (addedCount === 0) {
      new Notice(t("notice.notesAlreadyExcluded"));
      return;
    }
    this.settings.excludedNotePaths = next;
    await this.saveSettingsAndRefresh();
    new Notice(t("notice.notesExcluded", { count: addedCount }));
  }

  getNoteFiles(filePaths: string[]): TFile[] {
    const files: TFile[] = [];
    const seen = new Set<string>();
    for (const filePath of filePaths) {
      if (seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        files.push(file);
      }
    }
    return files;
  }

  async renameNote(filePath: string, newBaseName: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice(t("notice.fileUnavailable"));
      return false;
    }

    const target = buildRenameNoteTarget(
      file.path,
      newBaseName,
      (path) => this.app.vault.getAbstractFileByPath(path) !== null,
    );
    if (!target.ok || !target.newPath) {
      if (target.reason === "exists") {
        new Notice(t("notice.noteExists"));
      } else if (target.reason !== "same") {
        new Notice(t("notice.invalidNoteName"));
      }
      return false;
    }

    try {
      await this.app.fileManager.renameFile(file, target.newPath);
      this.queueRebuild();
      return true;
    } catch (error) {
      console.error("Tag Explorer could not rename note", error);
      new Notice(t("notice.renameFailed"));
      return false;
    }
  }

  private async handleVaultRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!(file instanceof TFile) || oldPath === file.path || !this.isNoteExcluded(oldPath)) {
      return;
    }
    this.settings.excludedNotePaths = normalizeNotePaths(
      this.settings.excludedNotePaths.map((path) => path === oldPath ? file.path : path),
    );
    await this.saveSettings();
  }

  async deleteNotes(filePaths: string[]): Promise<string[]> {
    const files = this.getNoteFiles(filePaths);
    if (files.length === 0) {
      new Notice(t("notice.fileUnavailable"));
      return [];
    }

    let confirmed = false;
    if (files.length === 1) {
      confirmed = await this.app.fileManager.promptForDeletion(files[0]);
    } else {
      confirmed = await confirmDeleteNotes(this.app, files.map((file) => file.path));
    }
    if (!confirmed) {
      return [];
    }

    const deletedPaths: string[] = [];
    for (const file of files) {
      try {
        await this.app.fileManager.trashFile(file);
        deletedPaths.push(file.path);
      } catch (error) {
        console.error("Tag Explorer could not delete note", error);
        new Notice(t("notice.deleteFailed"));
      }
    }
    this.queueRebuild();
    return deletedPaths;
  }

  async renameTag(tagPath: string, options: OperationOptions = {}): Promise<void> {
    const input = await promptForText(
      this.app,
      t("modal.renameTag.title"),
      t("modal.renameTag.name"),
      nameOfTag(tagPath),
      "new-tag",
    );
    if (input === null) {
      return;
    }

    const targetPath = resolveRenameTarget(tagPath, input);
    if (!targetPath || targetPath === tagPath) {
      new Notice(t("notice.invalidTagName"));
      return;
    }

    await this.previewAndApplyTagOperation(tagPath, targetPath, t("modal.renameTag.title"), options);
  }

  async moveTag(tagPath: string, options: OperationOptions = {}): Promise<void> {
    const parent = await chooseParentTag(
      this.app,
      this.getAllTagPaths().filter((tag) => tag !== tagPath && !tag.startsWith(`${tagPath}/`)),
      true,
    );
    if (parent === null) {
      return;
    }

    const targetPath = resolveMoveTarget(tagPath, parent);
    if (!targetPath || targetPath === tagPath) {
      new Notice(t("notice.invalidTagName"));
      return;
    }

    await this.previewAndApplyTagOperation(tagPath, targetPath, t("menu.moveTagFolder"), options);
  }

  async chooseAndMoveNoteToTag(filePath: string, sourceTag: string, options: OperationOptions = {}): Promise<void> {
    await this.chooseAndMoveNotesToTag([{ filePath, sourceTag }], options);
  }

  async chooseAndMoveNotesToTag(
    notes: Array<{ filePath: string; sourceTag: string }>,
    options: OperationOptions = {},
  ): Promise<void> {
    if (notes.length === 0) {
      new Notice(t("notice.fileUnavailable"));
      return;
    }
    const targetTag = await chooseParentTag(this.app, this.getAllTagPaths(), false);
    if (targetTag === null) {
      return;
    }
    await this.moveNotesToTag(notes, targetTag, options);
  }

  async chooseAndAddUntaggedNoteToTag(filePath: string, options: OperationOptions = {}): Promise<void> {
    await this.chooseAndAddUntaggedNotesToTag([filePath], options);
  }

  async chooseAndAddUntaggedNotesToTag(filePaths: string[], options: OperationOptions = {}): Promise<void> {
    if (filePaths.length === 0) {
      new Notice(t("notice.fileUnavailable"));
      return;
    }
    const targetTag = await chooseParentTag(this.app, this.getAllTagPaths(), false);
    if (targetTag === null) {
      return;
    }
    await this.addUntaggedNotesToTag(filePaths, targetTag, options);
  }

  async createTagFolder(parentPath: string): Promise<void> {
    const input = await promptForText(
      this.app,
      parentPath ? t("modal.createChildTagFolder.title") : t("modal.createRootTagFolder.title"),
      t("modal.tagFolderName"),
      "",
      "tag-folder-name",
    );
    if (input === null) {
      return;
    }

    const normalized = normalizeTag(input);
    if (!normalized) {
      new Notice(t("notice.invalidTagFolderName"));
      return;
    }

    const targetPath = parentPath ? `${parentPath}/${normalized}` : normalized;
    if (this.settings.tagFolders.includes(targetPath) || this.getAllTagPaths().includes(targetPath)) {
      new Notice(t("notice.tagFolderExists"));
      return;
    }

    this.settings.tagFolders = normalizeTags([...this.settings.tagFolders, targetPath]);
    await this.saveSettingsAndRefresh();
  }

  async deleteTagFolder(tagPath: string): Promise<void> {
    const node = this.findTagNode(tagPath);
    if (!node || !canDeleteTagFolderSubtree(node)) {
      new Notice(t("notice.onlyEmptyTagFolders"));
      return;
    }

    const removals = this.settings.tagFolders.filter((folder) =>
      folder === tagPath || folder.startsWith(`${tagPath}/`)
    );
    const plan = createOperationPlan(tagPath, tagPath, "subtree", [], [], removals);
    const confirmed = await confirmTagOperation(
      this.app,
      t("modal.deleteTagFolder.title"),
      plan,
      confirmVariantForAction("delete"),
    );
    if (!confirmed) {
      return;
    }

    this.settings.tagFolders = this.settings.tagFolders.filter((folder) =>
      folder !== tagPath && !folder.startsWith(`${tagPath}/`)
    );
    this.collapseRecursively(tagPath);
    await this.saveSettingsAndRefresh();
  }

  async moveNoteToTag(
    filePath: string,
    sourceTag: string,
    targetTag: string,
    options: OperationOptions = {},
  ): Promise<void> {
    await this.moveNotesToTag([{ filePath, sourceTag }], targetTag, options);
  }

  async moveNotesToTag(
    notes: Array<{ filePath: string; sourceTag: string }>,
    targetTag: string,
    options: OperationOptions = {},
  ): Promise<void> {
    const plans: TagOperationPlan[] = [];
    const sourceTags = new Map<string, Set<string>>();
    for (const note of notes) {
      if (note.sourceTag === targetTag) {
        continue;
      }
      const files = sourceTags.get(note.sourceTag) ?? new Set<string>();
      files.add(note.filePath);
      sourceTags.set(note.sourceTag, files);
    }

    for (const [sourceTag, filePaths] of sourceTags) {
      const plan = this.buildTagOperationPlan(sourceTag, targetTag, "exact", filePaths);
      if (plan.entries.length > 0) {
        plans.push(plan);
      }
    }

    if (plans.length === 0) {
      new Notice(t("notice.noMatchingTag"));
      return;
    }

    if (shouldConfirmOperation(options)) {
      const confirmed = await confirmTagOperation(
        this.app,
        t("modal.moveNote.title"),
        this.createBatchPreviewPlan(plans, t("modal.moveNote.title")),
      );
      if (!confirmed) {
        return;
      }
    }

    const stats = await this.applyTagOperationBatch(plans);
    this.lastOperation = { type: "tag", plans };
    new Notice(t("notice.updated", { files: stats.changedFiles, properties: stats.propertyCount, inline: stats.inlineCount }));
    this.rebuildViews();
  }

  async addUntaggedNoteToTag(
    filePath: string,
    targetTag: string,
    options: OperationOptions = {},
  ): Promise<void> {
    await this.addUntaggedNotesToTag([filePath], targetTag, options);
  }

  async addUntaggedNotesToTag(
    filePaths: string[],
    targetTag: string,
    options: OperationOptions = {},
  ): Promise<void> {
    const entries: TagOperationEntry[] = [];
    for (const filePath of Array.from(new Set(filePaths))) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        entries.push({
          path: file.path,
          propertyCount: 1,
          inlineCount: 0,
        });
      }
    }

    if (entries.length === 0) {
      new Notice(t("notice.fileUnavailable"));
      return;
    }

    if (shouldConfirmOperation(options)) {
      const preview = createOperationPlan("", targetTag, "exact", entries, [], [], t("modal.addUntagged.title"));
      const confirmed = await confirmTagOperation(this.app, t("modal.addUntagged.title"), preview);
      if (!confirmed) {
        return;
      }
    }

    const changedEntries: TagOperationEntry[] = [];
    for (const entry of entries) {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) {
        continue;
      }
      try {
        if (await this.applyPropertyTagChange(file, targetTag, "add")) {
          changedEntries.push(entry);
        }
      } catch (error) {
        console.error("Tag Explorer could not add tag to note", error);
        new Notice(t("notice.addTagFailed"));
      }
    }

    if (changedEntries.length === 0) {
      new Notice(t("notice.tagAlreadyPresent"));
      return;
    }

    this.lastOperation = { type: "untagged-add", targetTag, entries: changedEntries };
    new Notice(t("notice.updated", { files: changedEntries.length, properties: changedEntries.length, inline: 0 }));
    this.rebuildViews();
  }

  async undoLastUntaggedAdd(): Promise<boolean> {
    if (!this.lastOperation || this.lastOperation.type !== "untagged-add") {
      return false;
    }

    let changed = false;
    for (const entry of this.lastOperation.entries) {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (file instanceof TFile) {
        changed = await this.applyPropertyTagChange(file, this.lastOperation.targetTag, "remove") || changed;
      }
    }

    if (changed) {
      this.lastOperation = null;
      new Notice(t("notice.removedTag"));
      this.rebuildViews();
    }
    return changed;
  }

  async moveTagToParent(
    sourcePath: string,
    targetParentPath: string,
    options: OperationOptions = {},
  ): Promise<void> {
    await this.moveTagsToParent([sourcePath], targetParentPath, options);
  }

  async moveTagsToParent(
    sourcePaths: string[],
    targetParentPath: string,
    options: OperationOptions = {},
  ): Promise<void> {
    const plans: TagOperationPlan[] = [];
    for (const sourcePath of normalizeTagMoveSources(sourcePaths)) {
      const targetPath = resolveMoveTarget(sourcePath, targetParentPath);
      if (!targetPath || isInvalidMoveTarget(sourcePath, targetPath)) {
        new Notice(t("notice.cannotMoveIntoSelf"));
        return;
      }

      const plan = this.buildTagOperationPlan(sourcePath, targetPath, "subtree");
      if (plan.entries.length > 0 || plan.tagFolderAdditions.length > 0 || plan.tagFolderRemovals.length > 0) {
        plans.push(plan);
      }
    }

    if (plans.length === 0) {
      new Notice(t("notice.noMatchingTags"));
      return;
    }

    if (shouldConfirmOperation(options)) {
      const confirmed = await confirmTagOperation(
        this.app,
        t("menu.moveTagFolder"),
        this.createBatchPreviewPlan(plans, t("menu.moveTagFolder")),
      );
      if (!confirmed) {
        return;
      }
    }

    const stats = await this.applyTagOperationBatch(plans);
    this.lastOperation = { type: "tag", plans };
    for (const plan of plans) {
      this.remapExpandedTags(plan.oldPath, plan.newPath);
    }
    await this.persistExpandedTags();
    new Notice(t("notice.updated", { files: stats.changedFiles, properties: stats.propertyCount, inline: stats.inlineCount }));
    this.rebuildViews();
  }

  async undoLastTagOperation(): Promise<void> {
    if (!this.lastOperation) {
      new Notice(t("notice.noUndo"));
      return;
    }

    if (await this.undoLastUntaggedAdd()) {
      return;
    }

    if (this.lastOperation.type !== "tag") {
      new Notice(t("notice.nothingToUndo"));
      return;
    }

    const undoPlans = [...this.lastOperation.plans].reverse()
      .map((plan) => this.buildTagOperationPlan(
        plan.newPath,
        plan.oldPath,
        plan.mode,
        new Set(plan.entries.map((entry) => entry.path)),
      ))
      .filter((plan) =>
        plan.entries.length > 0 || plan.tagFolderAdditions.length > 0 || plan.tagFolderRemovals.length > 0
      );

    if (undoPlans.length === 0) {
      new Notice(t("notice.nothingToUndo"));
      return;
    }

    const confirmed = await confirmTagOperation(
      this.app,
      t("modal.undo.title"),
      this.createBatchPreviewPlan(undoPlans, t("modal.undo.title")),
    );
    if (!confirmed) {
      return;
    }

    const stats = await this.applyTagOperationBatch(undoPlans);
    this.lastOperation = null;
    new Notice(t("notice.updated", { files: stats.changedFiles, properties: stats.propertyCount, inline: stats.inlineCount }));
    this.rebuildViews();
  }

  async openSearch(query: string): Promise<boolean> {
    try {
      const leaf = this.app.workspace.getLeavesOfType("search").first()
        ?? this.app.workspace.getLeftLeaf(false)
        ?? this.app.workspace.getLeaf(true);

      await leaf.setViewState({ type: "search", active: true });
      await this.app.workspace.revealLeaf(leaf);

      const viewWithSearch = leaf.view as unknown as {
        setViewData?: (data: string, clear: boolean) => void;
        showSearch?: (replace?: boolean) => void;
      };

      if (typeof viewWithSearch.setViewData !== "function") {
        return false;
      }

      viewWithSearch.setViewData(query, true);
      viewWithSearch.showSearch?.(true);
      return true;
    } catch (error) {
      console.error("Tag Explorer could not open Obsidian search", error);
      new Notice(t("notice.searchFailed"));
      return false;
    }
  }

  private async previewAndApplyTagOperation(
    oldPath: string,
    newPath: string,
    title: string,
    options: OperationOptions = {},
  ): Promise<void> {
    const plan = this.buildTagOperationPlan(oldPath, newPath, "subtree");
    if (plan.entries.length === 0 && plan.tagFolderAdditions.length === 0 && plan.tagFolderRemovals.length === 0) {
      new Notice(t("notice.noMatchingTags"));
      return;
    }

    if (shouldConfirmOperation(options)) {
      const confirmed = await confirmTagOperation(this.app, title, plan);
      if (!confirmed) {
        return;
      }
    }

    const stats = await this.applyTagOperation(plan, false);
    this.lastOperation = { type: "tag", plans: [plan] };
    this.remapExpandedTags(oldPath, newPath);
    await this.persistExpandedTags();
    new Notice(t("notice.updated", { files: stats.changedFiles, properties: stats.propertyCount, inline: stats.inlineCount }));
    this.rebuildViews();
  }

  private buildTagOperationPlan(
    oldPath: string,
    newPath: string,
    mode: TagOperationPlan["mode"],
    fileFilter?: Set<string>,
  ): TagOperationPlan {
    const entries = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (fileFilter && !fileFilter.has(file.path)) {
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        continue;
      }

      const propertyCount = countPropertyTagReplacements(cache.frontmatter?.tags, oldPath, newPath, mode);
      const inlineCount = countInlineTagReplacements(
        this.inlineTagOccurrences(cache.tags ?? []),
        oldPath,
        newPath,
        cache.frontmatterPosition?.end.line ?? null,
        mode,
      );

      if (propertyCount > 0 || inlineCount > 0) {
        entries.push({ path: file.path, propertyCount, inlineCount });
      }
    }

    const remappedTagFolders = remapTagFolders(this.settings.tagFolders, oldPath, newPath, mode);
    const currentTagFolders = new Set(this.settings.tagFolders);
    const nextTagFolders = new Set(remappedTagFolders);
    const tagFolderAdditions = remappedTagFolders.filter((folder) => !currentTagFolders.has(folder));
    const tagFolderRemovals = this.settings.tagFolders.filter((folder) => !nextTagFolders.has(folder));

    return createOperationPlan(oldPath, newPath, mode, entries, tagFolderAdditions, tagFolderRemovals);
  }

  private createBatchPreviewPlan(plans: TagOperationPlan[], titleLine: string): TagOperationPlan {
    const entries = new Map<string, TagOperationEntry>();
    const tagFolderAdditions = new Set<string>();
    const tagFolderRemovals = new Set<string>();

    for (const plan of plans) {
      for (const entry of plan.entries) {
        const existing = entries.get(entry.path);
        if (existing) {
          existing.propertyCount += entry.propertyCount;
          existing.inlineCount += entry.inlineCount;
        } else {
          entries.set(entry.path, { ...entry });
        }
      }
      for (const path of plan.tagFolderAdditions) {
        tagFolderAdditions.add(path);
      }
      for (const path of plan.tagFolderRemovals) {
        tagFolderRemovals.add(path);
      }
    }

    return createOperationPlan(
      plans.length === 1 ? plans[0].oldPath : "",
      plans.length === 1 ? plans[0].newPath : "",
      "subtree",
      Array.from(entries.values()).sort((left, right) => left.path.localeCompare(right.path, undefined, {
        sensitivity: "base",
        numeric: true,
      })),
      Array.from(tagFolderAdditions),
      Array.from(tagFolderRemovals),
      titleLine,
    );
  }

  private async applyTagOperationBatch(plans: TagOperationPlan[]): Promise<OperationStats> {
    const stats: OperationStats = { changedFiles: 0, propertyCount: 0, inlineCount: 0 };
    for (const plan of plans) {
      const planStats = await this.applyTagOperation(plan, false);
      stats.changedFiles += planStats.changedFiles;
      stats.propertyCount += planStats.propertyCount;
      stats.inlineCount += planStats.inlineCount;
    }
    return stats;
  }

  private async applyTagOperation(plan: TagOperationPlan, notify = true): Promise<OperationStats> {
    let changedFiles = 0;
    let propertyCount = 0;
    let inlineCount = 0;

    for (const entry of plan.entries) {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) {
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        continue;
      }

      let changed = false;

      if (entry.inlineCount > 0) {
        const inlineResult = await this.app.vault.process(file, (content) => {
          const result = rewriteInlineTags(
            content,
            this.inlineTagOccurrences(cache.tags ?? []),
            plan.oldPath,
            plan.newPath,
            cache.frontmatterPosition?.end.line ?? null,
            plan.mode,
          );
          inlineCount += result.count;
          return result.content;
        });
        changed = changed || inlineResult.length > 0;
      }

      if (entry.propertyCount > 0) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: TagFrontmatter) => {
          const result = rewritePropertyTags(frontmatter.tags, plan.oldPath, plan.newPath, plan.mode);
          if (result.changed) {
            frontmatter.tags = result.value;
            propertyCount += result.count;
            changed = true;
          }
        });
      }

      if (changed) {
        changedFiles += 1;
      }
    }

    if (plan.tagFolderAdditions.length > 0 || plan.tagFolderRemovals.length > 0) {
      this.settings.tagFolders = remapTagFolders(
        this.settings.tagFolders,
        plan.oldPath,
        plan.newPath,
        plan.mode,
      );
      await this.saveSettings();
    }

    if (notify) {
      new Notice(t("notice.updated", { files: changedFiles, properties: propertyCount, inline: inlineCount }));
    }
    return { changedFiles, propertyCount, inlineCount };
  }

  private inlineTagOccurrences(tags: TagCache[]): InlineTagOccurrence[] {
    return tags.map((tag) => ({
      tag: tag.tag,
      position: tag.position,
    }));
  }

  private async applyPropertyTagChange(file: TFile, tagPath: string, action: "add" | "remove"): Promise<boolean> {
    let changed = false;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: TagFrontmatter) => {
      const result = action === "add"
        ? addPropertyTag(frontmatter.tags, tagPath)
        : removePropertyTag(frontmatter.tags, tagPath);
      if (result.changed) {
        frontmatter.tags = result.value;
        changed = true;
      }
    });
    return changed;
  }

  private remapExpandedTags(oldPath: string, newPath: string): void {
    const next = new Set<string>();
    for (const tag of this.expandedTags) {
      if (tag === oldPath) {
        next.add(newPath);
      } else if (tag.startsWith(`${oldPath}/`)) {
        next.add(`${newPath}${tag.slice(oldPath.length)}`);
      } else {
        next.add(tag);
      }
    }
    this.expandedTags = next;
  }

  private createCurrentTagTree(): TagTreeNode {
    return createTagTree(this.getIndexedNotes(), this.settings.tagFolders, {
      counterMode: this.settings.counterMode,
      tagSort: this.settings.tagSort,
      noteSort: this.settings.noteSort,
    });
  }

  private findTagNode(tagPath: string): TagTreeNode | null {
    const stack = [...this.createCurrentTagTree().children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (node.path === tagPath) {
        return node;
      }
      stack.push(...node.children);
    }
    return null;
  }

  private tagsForFile(cache: CachedMetadata | null): string[] {
    if (!cache) {
      return [];
    }

    if (this.settings.tagSourceMode === "properties-only") {
      return extractPropertyTags(cache.frontmatter?.tags);
    }

    return normalizeTags(getAllTags(cache) ?? []);
  }
}

import { ItemView, Menu, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import {
  resolveDragPayload,
  type DragPayload,
  type SingleDragPayload,
} from "./drag-payload";
import { TAG_EXPLORER_ICON_ID } from "./icons";
import { t } from "./i18n";
import type TagExplorerPlugin from "./main";
import {
  noteKeyboardAction,
  notePayloadsFromSelection,
} from "./note-actions";
import {
  applySelectionClick,
  selectionKey,
  type SelectionItem,
} from "./selection";
import {
  countForNode,
  createTagTree,
  toRenderableTree,
  type RenderableTagNode,
  type TagTreeOptions,
} from "./tag-index";
import {
  actionForTouchMenuTimer,
  actionForTouchMove,
  actionForTouchSelectTimer,
  touchGestureDistance,
} from "./touch-gesture";
import { VIEW_TYPE_TAG_EXPLORER } from "./types";
import type { IndexedNote } from "./types";

const DRAG_MIME = "application/x-tag-explorer";
const TOUCH_SELECT_DELAY_MS = 320;
const TOUCH_MENU_DELAY_MS = 650;
const TOUCH_DRAG_THRESHOLD_PX = 9;
const TOUCH_AUTO_SCROLL_EDGE_PX = 48;
const TOUCH_AUTO_SCROLL_STEP_PX = 14;

interface TouchGestureState {
  pointerId: number;
  element: HTMLElement;
  item: SelectionItem;
  payload: SingleDragPayload;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  selectTimer: number;
  menuTimer: number;
  selected: boolean;
  dragging: boolean;
  menuOpened: boolean;
}

interface TouchDragState {
  payload: DragPayload;
  sourceEl: HTMLElement;
  previewEl: HTMLElement;
  currentDropEl: HTMLElement | null;
}

export class TagExplorerView extends ItemView {
  private filter = "";
  private searchVisible = false;
  private treeContainerEl: HTMLElement | null = null;
  private touchGesture: TouchGestureState | null = null;
  private touchDrag: TouchDragState | null = null;
  private selectedKeys = new Set<string>();
  private lastSelectedKey: string | null = null;
  private visibleSelectionItems: SelectionItem[] = [];
  private selectionPayloads = new Map<string, SingleDragPayload>();
  private currentDragPayload: DragPayload | null = null;
  private renamingNoteKey: string | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TagExplorerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TAG_EXPLORER;
  }

  getDisplayText(): string {
    return t("app.name");
  }

  getIcon(): string {
    return TAG_EXPLORER_ICON_ID;
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tag-explorer-view");

    const toolbarEl = contentEl.createDiv({ cls: "tag-explorer-toolbar" });
    this.addToolbarButton(toolbarEl, t("toolbar.createRootTagFolder"), "folder-plus", () => {
      void this.plugin.createTagFolder("");
    });
    this.addToolbarButton(toolbarEl, t("toolbar.sort"), "arrow-up-narrow-wide", (event) => this.openSortMenu(event));
    const allExpanded = this.areAllTagsExpanded();
    this.addToolbarButton(
      toolbarEl,
      allExpanded ? t("toolbar.collapseAll") : t("toolbar.expandAll"),
      allExpanded ? "chevrons-down-up" : "chevrons-up-down",
      () => {
        void this.toggleExpandCollapseAll();
      },
    );
    this.addToolbarButton(toolbarEl, this.sourceModeTitle(), this.sourceModeIcon(), () => {
      void this.toggleSourceMode();
    }, this.plugin.settings.tagSourceMode === "properties-only");
    this.addToolbarButton(
      toolbarEl,
      this.plugin.settings.showUntaggedSection ? t("toolbar.untagged.hide") : t("toolbar.untagged.show"),
      "inbox",
      () => {
        void this.toggleUntaggedSection();
      },
      this.plugin.settings.showUntaggedSection,
    );
    this.addToolbarButton(toolbarEl, t("toolbar.search"), "search", () => {
      this.searchVisible = !this.searchVisible;
      this.render();
    }, this.searchVisible || this.filter.length > 0);

    if (this.plugin.hasUndoOperation()) {
      this.addToolbarButton(toolbarEl, t("toolbar.undo"), "undo-2", () => {
        void this.plugin.undoLastTagOperation();
      });
    }

    if (this.searchVisible || this.filter.length > 0) {
      const filterEl = contentEl.createEl("input", {
        cls: "tag-explorer-filter",
        attr: {
          type: "search",
          placeholder: t("filter.placeholder"),
          value: this.filter,
        },
      });
      filterEl.addEventListener("input", () => {
        this.filter = filterEl.value;
        this.renderTree();
      });
      window.setTimeout(() => filterEl.focus(), 0);
    }

    this.treeContainerEl = contentEl.createDiv({ cls: "tag-explorer-tree" });
    this.treeContainerEl.tabIndex = 0;
    this.treeContainerEl.addEventListener("keydown", (event) => {
      void this.handleTreeKeyDown(event);
    });
    this.attachDropTarget(this.treeContainerEl, "", true);
    this.treeContainerEl.addEventListener("contextmenu", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".tag-explorer-row")) {
        return;
      }
      event.preventDefault();
      this.openRootMenu(event);
    });
    this.renderTree();
  }

  private renderTree(): void {
    if (!this.treeContainerEl) {
      return;
    }

    this.treeContainerEl.empty();
    this.attachDropTarget(this.treeContainerEl, "", true);
    this.visibleSelectionItems = [];
    this.selectionPayloads.clear();

    const options = this.treeOptions();
    const root = createTagTree(this.plugin.getIndexedNotes(), this.plugin.settings.tagFolders, options);
    const nodes = toRenderableTree(root, options, this.filter);

    const shouldRenderUntagged = this.plugin.settings.showUntaggedSection
      && this.plugin.getUntaggedNotes().length > 0;

    if (nodes.length === 0 && !shouldRenderUntagged) {
      this.treeContainerEl.createDiv({
        cls: "tag-explorer-empty",
        text: this.filter.trim() ? t("tree.emptyFiltered") : t("tree.empty"),
      });
      return;
    }

    for (const node of nodes) {
      this.renderTagNode(this.treeContainerEl, node);
    }

    if (shouldRenderUntagged) {
      this.renderUntaggedSection(this.treeContainerEl);
    }

    this.pruneSelectionToVisibleItems();
  }

  private renderUntaggedSection(parentEl: HTMLElement): void {
    const notes = this.plugin.getUntaggedNotes();
    if (notes.length === 0) {
      return;
    }

    const itemEl = parentEl.createDiv({ cls: "tag-explorer-item tag-explorer-untagged" });
    const rowEl = itemEl.createDiv({ cls: "tag-explorer-row tag-explorer-tag-row" });
    rowEl.setAttr("role", "button");

    const isExpanded = this.isExpanded("__untagged__");
    const chevronEl = rowEl.createSpan({ cls: "tag-explorer-chevron" });
    setIcon(chevronEl, isExpanded ? "chevron-down" : "chevron-right");

    const iconEl = rowEl.createSpan({ cls: "tag-explorer-row-icon" });
    setIcon(iconEl, "inbox");
    rowEl.createSpan({ cls: "tag-explorer-label", text: t("tree.untagged") });
    rowEl.createSpan({ cls: "tag-explorer-count", text: String(notes.length) });
    rowEl.addEventListener("click", (event) => {
      if (this.consumeSuppressedClick(rowEl, event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void this.toggleTag("__untagged__");
    });

    if (!isExpanded) {
      return;
    }

    const childrenEl = itemEl.createDiv({ cls: "tag-explorer-children" });
    for (const note of notes) {
      this.renderUntaggedNoteRow(childrenEl, note);
    }
  }

  private renderTagNode(parentEl: HTMLElement, renderable: RenderableTagNode): void {
    const { node } = renderable;
    const isExpanded = this.filter.trim().length > 0 || this.isExpanded(node.path);
    const hasChildren = renderable.children.length > 0 || renderable.notes.length > 0;

    const itemEl = parentEl.createDiv({ cls: "tag-explorer-item" });
    const rowEl = itemEl.createDiv({ cls: "tag-explorer-row tag-explorer-tag-row" });
    rowEl.setAttr("role", "button");
    rowEl.setAttr("aria-expanded", String(isExpanded));
    rowEl.draggable = true;
    rowEl.toggleClass("is-tag-folder", node.isTagFolder && !node.hasRealTag);
    rowEl.toggleClass("is-drop-target", false);
    const selectionItem = { key: selectionKey("tag", node.path), kind: "tag" as const };
    this.registerSelectionItem(rowEl, selectionItem, { type: "tag", path: node.path });
    this.attachDragSource(rowEl, selectionItem, { type: "tag", path: node.path });
    this.attachDropTarget(rowEl, node.path, false);

    const chevronEl = rowEl.createSpan({ cls: "tag-explorer-chevron" });
    setIcon(chevronEl, hasChildren && isExpanded ? "chevron-down" : "chevron-right");
    if (!hasChildren) {
      chevronEl.addClass("tag-explorer-chevron-empty");
    }

    const iconEl = rowEl.createSpan({ cls: "tag-explorer-row-icon" });
    setIcon(iconEl, node.isTagFolder && !node.hasRealTag ? "folder" : "tags");

    rowEl.createSpan({ cls: "tag-explorer-label", text: node.name });
    rowEl.createSpan({
      cls: "tag-explorer-count",
      text: String(countForNode(node, this.plugin.settings.counterMode)),
    });

    rowEl.addEventListener("click", (event) => {
      if (this.consumeSuppressedClick(rowEl, event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selectionOnly = this.handleSelectionClick(event, selectionItem);
      if (selectionOnly) {
        return;
      }
      void this.toggleTag(node.path);
    });
    rowEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.selectItemForContextMenu(selectionItem);
      this.openTagMenu(event, renderable);
    });
    this.attachTouchInteraction(rowEl, selectionItem, { type: "tag", path: node.path });

    if (!isExpanded) {
      return;
    }

    const childrenEl = itemEl.createDiv({ cls: "tag-explorer-children" });
    for (const child of renderable.children) {
      this.renderTagNode(childrenEl, child);
    }
    for (const note of renderable.notes) {
      this.renderNoteRow(childrenEl, note, node.path);
    }
  }

  private renderNoteRow(parentEl: HTMLElement, note: IndexedNote, sourceTag: string): void {
    const rowEl = parentEl.createDiv({ cls: "tag-explorer-row tag-explorer-note-row" });
    rowEl.setAttr("role", "button");
    rowEl.draggable = true;
    const selectionItem = { key: selectionKey("note", note.path, sourceTag), kind: "note" as const };
    this.registerSelectionItem(rowEl, selectionItem, { type: "note", filePath: note.path, sourceTag });
    this.attachDragSource(rowEl, selectionItem, { type: "note", filePath: note.path, sourceTag });
    if (this.plugin.settings.showFullPathOnHover) {
      rowEl.setAttr("title", note.path);
    }

    const spacerEl = rowEl.createSpan({ cls: "tag-explorer-chevron tag-explorer-chevron-empty" });
    spacerEl.setText("");

    this.renderNoteLabelOrEditor(rowEl, note, selectionItem.key);

    rowEl.addEventListener("click", (event) => {
      if (this.consumeSuppressedClick(rowEl, event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selectionOnly = this.handleSelectionClick(event, selectionItem);
      this.treeContainerEl?.focus();
      if (selectionOnly) {
        return;
      }
      void this.openNote(note, false);
    });
    rowEl.addEventListener("auxclick", (event) => {
      if (event.button !== 1) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void this.openNote(note, "tab");
    });
    rowEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.selectItemForContextMenu(selectionItem);
      this.openNoteMenu(event, note, sourceTag);
    });
    this.attachTouchInteraction(rowEl, selectionItem, { type: "note", filePath: note.path, sourceTag });
  }

  private renderUntaggedNoteRow(parentEl: HTMLElement, note: IndexedNote): void {
    const rowEl = parentEl.createDiv({ cls: "tag-explorer-row tag-explorer-note-row" });
    rowEl.setAttr("role", "button");
    rowEl.draggable = true;
    const selectionItem = { key: selectionKey("untagged-note", note.path), kind: "untagged-note" as const };
    this.registerSelectionItem(rowEl, selectionItem, { type: "untagged-note", filePath: note.path });
    this.attachDragSource(rowEl, selectionItem, { type: "untagged-note", filePath: note.path });
    if (this.plugin.settings.showFullPathOnHover) {
      rowEl.setAttr("title", note.path);
    }

    const spacerEl = rowEl.createSpan({ cls: "tag-explorer-chevron tag-explorer-chevron-empty" });
    spacerEl.setText("");
    this.renderNoteLabelOrEditor(rowEl, note, selectionItem.key);

    rowEl.addEventListener("click", (event) => {
      if (this.consumeSuppressedClick(rowEl, event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selectionOnly = this.handleSelectionClick(event, selectionItem);
      this.treeContainerEl?.focus();
      if (selectionOnly) {
        return;
      }
      void this.openNote(note, false);
    });
    rowEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.selectItemForContextMenu(selectionItem);
      this.openNoteMenu(event, note, null);
    });
    this.attachTouchInteraction(rowEl, selectionItem, { type: "untagged-note", filePath: note.path });
  }

  private renderNoteLabelOrEditor(rowEl: HTMLElement, note: IndexedNote, selectionKeyValue: string): void {
    if (this.renamingNoteKey !== selectionKeyValue) {
      rowEl.createSpan({
        cls: "tag-explorer-label",
        text: this.plugin.settings.showNoteFileExtension ? `${note.basename}.${note.extension}` : note.basename,
      });
      return;
    }

    rowEl.draggable = false;
    const inputEl = rowEl.createEl("input", {
      cls: "tag-explorer-rename-input",
      attr: {
        type: "text",
        value: note.basename,
        "aria-label": t("menu.renameNote"),
      },
    });
    let keepEditing = false;
    let finished = false;

    const cancel = () => {
      if (finished) {
        return;
      }
      finished = true;
      this.renamingNoteKey = null;
      this.renderTree();
    };

    const apply = async () => {
      if (finished) {
        return;
      }
      const renamed = await this.plugin.renameNote(note.path, inputEl.value);
      if (renamed) {
        finished = true;
        this.renamingNoteKey = null;
        this.selectedKeys.delete(selectionKeyValue);
        this.lastSelectedKey = null;
        this.renderTree();
      } else {
        keepEditing = true;
        window.setTimeout(() => {
          keepEditing = false;
          inputEl.focus();
          inputEl.select();
        }, 0);
      }
    };

    inputEl.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    inputEl.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        void apply();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
    inputEl.addEventListener("blur", () => {
      if (!keepEditing) {
        cancel();
      }
    });
    window.setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 0);
  }

  private treeOptions(): TagTreeOptions {
    return {
      counterMode: this.plugin.settings.counterMode,
      tagSort: this.plugin.settings.tagSort,
      noteSort: this.plugin.settings.noteSort,
    };
  }

  private isExpanded(tagPath: string): boolean {
    return this.plugin.expandedTags.has(tagPath);
  }

  private async toggleTag(tagPath: string): Promise<void> {
    if (this.plugin.expandedTags.has(tagPath)) {
      this.plugin.expandedTags.delete(tagPath);
    } else {
      this.plugin.expandedTags.add(tagPath);
    }
    await this.plugin.persistExpandedTags();
    this.renderTree();
  }

  private areAllTagsExpanded(): boolean {
    const paths = this.expandableTagPaths();
    return paths.length > 0 && paths.every((path) => this.plugin.expandedTags.has(path));
  }

  private expandableTagPaths(): string[] {
    const root = createTagTree(this.plugin.getIndexedNotes(), this.plugin.settings.tagFolders, this.treeOptions());
    const paths: string[] = [];
    const stack = [...root.children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      paths.push(node.path);
      stack.push(...node.children);
    }
    if (this.plugin.settings.showUntaggedSection && this.plugin.getUntaggedNotes().length > 0) {
      paths.push("__untagged__");
    }
    return paths;
  }

  private async toggleExpandCollapseAll(): Promise<void> {
    if (this.areAllTagsExpanded()) {
      this.plugin.collapseAll();
    } else {
      this.plugin.expandAll();
      if (this.plugin.settings.showUntaggedSection && this.plugin.getUntaggedNotes().length > 0) {
        this.plugin.expandedTags.add("__untagged__");
      }
    }
    await this.plugin.persistExpandedTags();
    this.render();
  }

  private sourceModeTitle(): string {
    return this.plugin.settings.tagSourceMode === "all-tags"
      ? t("toolbar.source.all")
      : t("toolbar.source.properties");
  }

  private sourceModeIcon(): string {
    return this.plugin.settings.tagSourceMode === "all-tags" ? "tags" : "database";
  }

  private async toggleSourceMode(): Promise<void> {
    await this.setSourceMode(this.plugin.settings.tagSourceMode === "all-tags" ? "properties-only" : "all-tags");
  }

  private async toggleUntaggedSection(): Promise<void> {
    this.plugin.settings.showUntaggedSection = !this.plugin.settings.showUntaggedSection;
    await this.plugin.saveSettingsAndRefresh();
  }

  private registerSelectionItem(
    rowEl: HTMLElement,
    item: SelectionItem,
    payload: SingleDragPayload,
  ): void {
    this.visibleSelectionItems.push(item);
    this.selectionPayloads.set(item.key, payload);
    rowEl.dataset.selectionKey = item.key;
    rowEl.setAttr("aria-selected", String(this.selectedKeys.has(item.key)));
    rowEl.toggleClass("is-selected", this.selectedKeys.has(item.key));
  }

  private handleSelectionClick(event: MouseEvent, item: SelectionItem): boolean {
    const selectionOnly = event.shiftKey || event.ctrlKey || event.metaKey;
    const next = applySelectionClick(
      {
        selectedKeys: this.selectedKeys,
        lastSelectedKey: this.lastSelectedKey,
      },
      item,
      this.visibleSelectionItems,
      {
        shiftKey: event.shiftKey,
        toggleKey: event.ctrlKey || event.metaKey,
      },
    );
    this.selectedKeys = next.selectedKeys;
    this.lastSelectedKey = next.lastSelectedKey;
    this.syncSelectionClasses();
    return selectionOnly;
  }

  private selectItemForContextMenu(item: SelectionItem): void {
    if (this.selectedKeys.has(item.key)) {
      this.lastSelectedKey = item.key;
      return;
    }
    this.selectedKeys = new Set([item.key]);
    this.lastSelectedKey = item.key;
    this.syncSelectionClasses();
  }

  private selectItemForTouch(item: SelectionItem): void {
    this.selectItemForContextMenu(item);
    this.treeContainerEl?.focus();
  }

  private suppressNextClick(element: HTMLElement): void {
    element.dataset.suppressClick = "true";
    window.setTimeout(() => {
      if (element.dataset.suppressClick === "true") {
        delete element.dataset.suppressClick;
      }
    }, 700);
  }

  private consumeSuppressedClick(element: HTMLElement, event: MouseEvent): boolean {
    if (element.dataset.suppressClick !== "true") {
      return false;
    }
    delete element.dataset.suppressClick;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  private pruneSelectionToVisibleItems(): void {
    const visibleKeys = new Set(this.visibleSelectionItems.map((item) => item.key));
    let changed = false;
    for (const key of Array.from(this.selectedKeys)) {
      if (!visibleKeys.has(key)) {
        this.selectedKeys.delete(key);
        changed = true;
      }
    }
    if (this.lastSelectedKey && !visibleKeys.has(this.lastSelectedKey)) {
      this.lastSelectedKey = null;
      changed = true;
    }
    if (changed) {
      this.syncSelectionClasses();
    }
  }

  private syncSelectionClasses(): void {
    this.treeContainerEl?.querySelectorAll<HTMLElement>(".tag-explorer-row[data-selection-key]").forEach((row) => {
      const key = row.dataset.selectionKey;
      const selected = !!key && this.selectedKeys.has(key);
      row.toggleClass("is-selected", selected);
      row.setAttr("aria-selected", String(selected));
    });
  }

  private selectedNotePayloads(): SingleDragPayload[] {
    return notePayloadsFromSelection(Array.from(this.selectedKeys).map((key) => this.selectionPayloads.get(key)));
  }

  private async handleTreeKeyDown(event: KeyboardEvent): Promise<void> {
    const target = event.target;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    const selectedNotes = this.selectedNotePayloads();
    const action = noteKeyboardAction(selectedNotes, event);
    if (!action) {
      return;
    }
    event.preventDefault();
    if (action === "rename") {
      this.startRenameForPayload(selectedNotes[0]);
    } else if (action === "delete") {
      await this.deleteNotePayloads(selectedNotes);
    } else {
      await this.openNoteFromPayload(selectedNotes[0], action === "open-new-tab" ? "tab" : false);
    }
  }

  private noteForPayload(payload: SingleDragPayload): IndexedNote | null {
    if (payload.type !== "note" && payload.type !== "untagged-note") {
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(payload.filePath);
    if (!(file instanceof TFile)) {
      return null;
    }
    return {
      path: file.path,
      basename: file.basename,
      extension: file.extension,
      mtime: file.stat.mtime,
      file,
      tags: [],
    };
  }

  private async openNoteFromPayload(payload: SingleDragPayload, mode: false | "tab" | "split"): Promise<void> {
    const note = this.noteForPayload(payload);
    if (!note) {
      new Notice(t("notice.fileUnavailable"));
      return;
    }
    await this.openNote(note, mode);
  }

  private async deleteNotePayloads(payloads: SingleDragPayload[]): Promise<void> {
    const paths = payloads
      .filter((payload) => payload.type === "note" || payload.type === "untagged-note")
      .map((payload) => payload.filePath);
    const deletedPaths = await this.plugin.deleteNotes(paths);
    if (deletedPaths.length === 0) {
      return;
    }
    const deleted = new Set(deletedPaths);
    for (const [key, payload] of this.selectionPayloads) {
      if ((payload.type === "note" || payload.type === "untagged-note") && deleted.has(payload.filePath)) {
        this.selectedKeys.delete(key);
      }
    }
    this.lastSelectedKey = null;
    this.renamingNoteKey = null;
    this.renderTree();
  }

  private startRenameForPayload(payload: SingleDragPayload): void {
    if (payload.type !== "note" && payload.type !== "untagged-note") {
      return;
    }
    const key = this.keyForPayload(payload);
    if (!key) {
      return;
    }
    this.renamingNoteKey = key;
    this.renderTree();
  }

  private keyForPayload(payload: SingleDragPayload): string | null {
    for (const [key, candidate] of this.selectionPayloads) {
      if (candidate.type !== payload.type) {
        continue;
      }
      if (candidate.type === "tag" && payload.type === "tag" && candidate.path === payload.path) {
        return key;
      }
      if (candidate.type === "note" && payload.type === "note"
        && candidate.filePath === payload.filePath
        && candidate.sourceTag === payload.sourceTag) {
        return key;
      }
      if (candidate.type === "untagged-note" && payload.type === "untagged-note"
        && candidate.filePath === payload.filePath) {
        return key;
      }
    }
    return null;
  }

  private openRootMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle(t("menu.createRootTagFolder"))
        .setIcon("folder-plus")
        .onClick(() => this.plugin.createTagFolder(""));
    });
    menu.showAtMouseEvent(event);
  }

  private openTagMenu(event: MouseEvent, renderable: RenderableTagNode): void {
    const { node } = renderable;
    const tagPath = node.path;
    const menu = new Menu();
    const isExpanded = this.plugin.expandedTags.has(tagPath);

    menu.addItem((item) => {
      item
        .setTitle(t("menu.createChildTagFolder"))
        .setIcon("folder-plus")
        .onClick(() => this.plugin.createTagFolder(tagPath));
    });
    if (node.tagFolderOnly) {
      menu.addItem((item) => {
        item
          .setTitle(t("menu.deleteTagFolder"))
          .setIcon("trash-2")
          .onClick(() => this.plugin.deleteTagFolder(tagPath));
      });
    }
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(t("menu.renameTag"))
        .setIcon("pencil")
        .onClick(() => this.plugin.renameTag(tagPath, { confirm: false }));
    });
    menu.addItem((item) => {
      item
        .setTitle(t("menu.moveTagFolder"))
        .setIcon("folder-input")
        .onClick(() => this.plugin.moveTag(tagPath, { confirm: false }));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(isExpanded ? t("menu.collapse") : t("menu.expand"))
        .setIcon(isExpanded ? "chevron-right" : "chevron-down")
        .onClick(async () => {
          if (isExpanded) {
            this.plugin.expandedTags.delete(tagPath);
          } else {
            this.plugin.expandedTags.add(tagPath);
          }
          await this.plugin.persistExpandedTags();
          this.renderTree();
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(t("menu.expandRecursively"))
        .setIcon("list-tree")
        .onClick(async () => {
          this.plugin.expandRecursively(tagPath);
          await this.plugin.persistExpandedTags();
          this.renderTree();
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(t("menu.collapseRecursively"))
        .setIcon("list-collapse")
        .onClick(async () => {
          this.plugin.collapseRecursively(tagPath);
          await this.plugin.persistExpandedTags();
          this.renderTree();
        });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(t("menu.copyTag"))
        .setIcon("copy")
        .onClick(async () => {
          await navigator.clipboard.writeText(`#${tagPath}`);
          new Notice(t("notice.tagCopied"));
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(t("menu.copySearchQuery"))
        .setIcon("copy")
        .onClick(async () => {
          await navigator.clipboard.writeText(this.searchQueryForTag(tagPath));
          new Notice(t("notice.queryCopied"));
        });
    });

    if (this.plugin.settings.experimentalOpenSearch) {
      menu.addItem((item) => {
        item
          .setTitle(t("menu.openSearch"))
          .setIcon("search")
          .onClick(async () => {
            const opened = await this.plugin.openSearch(this.searchQueryForTag(tagPath));
            if (!opened) {
              await navigator.clipboard.writeText(this.searchQueryForTag(tagPath));
              new Notice(t("notice.queryCopiedOpenSearch"));
            }
          });
      });
    }

    menu.showAtMouseEvent(event);
  }

  private openNoteMenu(event: MouseEvent, note: IndexedNote, sourceTag: string | null): void {
    const currentPayload: SingleDragPayload = sourceTag
      ? { type: "note", filePath: note.path, sourceTag }
      : { type: "untagged-note", filePath: note.path };
    const currentKey = this.keyForPayload(currentPayload);
    const selectedNotes = currentKey && this.selectedKeys.has(currentKey)
      ? this.selectedNotePayloads()
      : [currentPayload];

    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle(t("menu.open"))
        .setIcon("file-text")
        .onClick(() => this.openNote(note, false));
    });
    menu.addItem((item) => {
      item
        .setTitle(t("menu.openNewTab"))
        .setIcon("external-link")
        .onClick(() => this.openNote(note, "tab"));
    });
    menu.addItem((item) => {
      item
        .setTitle(t("menu.openToRight"))
        .setIcon("separator-vertical")
        .onClick(() => this.openNote(note, "split"));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(t("menu.renameNote"))
        .setIcon("pencil")
        .onClick(() => this.startRenameForPayload(currentPayload));
    });
    menu.addItem((item) => {
      item
        .setTitle(t("menu.deleteNote"))
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => {
          void this.deleteNotePayloads(selectedNotes);
        });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(sourceTag ? t("menu.moveToTagFolder") : t("menu.addToTagFolder"))
        .setIcon(sourceTag ? "folder-input" : "tag")
        .onClick(() => {
          if (sourceTag) {
            const noteTargets = selectedNotes
              .filter((payload): payload is { type: "note"; filePath: string; sourceTag: string } =>
                payload.type === "note")
              .map((payload) => ({ filePath: payload.filePath, sourceTag: payload.sourceTag }));
            void this.plugin.chooseAndMoveNotesToTag(
              noteTargets.length > 0 ? noteTargets : [{ filePath: note.path, sourceTag }],
              { confirm: false },
            );
          } else {
            const filePaths = selectedNotes
              .filter((payload): payload is { type: "untagged-note"; filePath: string } =>
                payload.type === "untagged-note")
              .map((payload) => payload.filePath);
            void this.plugin.chooseAndAddUntaggedNotesToTag(
              filePaths.length > 0 ? filePaths : [note.path],
              { confirm: false },
            );
          }
        });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(t("menu.copyFilePath"))
        .setIcon("copy")
        .onClick(async () => {
          await navigator.clipboard.writeText(note.path);
          new Notice(t("notice.filePathCopied"));
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(t("menu.copyObsidianLink"))
        .setIcon("link")
        .onClick(async () => {
          await navigator.clipboard.writeText(`[[${note.path.replace(/\.md$/i, "")}]]`);
          new Notice(t("notice.linkCopied"));
        });
    });
    menu.showAtMouseEvent(event);
  }

  private searchQueryForTag(tagPath: string): string {
    return this.plugin.settings.tagSourceMode === "properties-only"
      ? `[tags:${tagPath}]`
      : `tag:#${tagPath}`;
  }

  private async openNote(note: IndexedNote, mode: false | "tab" | "split"): Promise<void> {
    if (!(note.file instanceof TFile)) {
      new Notice(t("notice.fileUnavailable"));
      return;
    }

    const leaf = this.app.workspace.getLeaf(mode);
    await leaf.openFile(note.file);
  }

  private addToolbarButton(
    parentEl: HTMLElement,
    label: string,
    icon: string,
    callback: (event: MouseEvent) => void,
    active = false,
  ): HTMLElement {
    const buttonEl = parentEl.createEl("button", {
      cls: "clickable-icon tag-explorer-icon-button",
      attr: { "aria-label": label },
    });
    if (active) {
      buttonEl.addClass("is-active");
    }
    setIcon(buttonEl, icon);
    buttonEl.addEventListener("click", (event) => {
      event.preventDefault();
      callback(event);
    });
    return buttonEl;
  }

  private openSortMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(t("sort.tagsNameAsc")).setIcon("arrow-up-a-z").onClick(() => this.setTagSort("name-asc"));
    });
    menu.addItem((item) => {
      item.setTitle(t("sort.tagsNameDesc")).setIcon("arrow-down-z-a").onClick(() => this.setTagSort("name-desc"));
    });
    menu.addItem((item) => {
      item.setTitle(t("sort.tagsCountDesc")).setIcon("arrow-down-1-0").onClick(() => this.setTagSort("count-desc"));
    });
    menu.addItem((item) => {
      item.setTitle(t("sort.tagsCountAsc")).setIcon("arrow-up-0-1").onClick(() => this.setTagSort("count-asc"));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(t("sort.notesNameAsc")).setIcon("arrow-up-a-z").onClick(() => this.setNoteSort("name-asc"));
    });
    menu.addItem((item) => {
      item.setTitle(t("sort.notesNameDesc")).setIcon("arrow-down-z-a").onClick(() => this.setNoteSort("name-desc"));
    });
    menu.addItem((item) => {
      item.setTitle(t("sort.notesModifiedDesc")).setIcon("arrow-down-wide-narrow").onClick(() => this.setNoteSort("modified-desc"));
    });
    menu.addItem((item) => {
      item.setTitle(t("sort.notesModifiedAsc")).setIcon("arrow-up-narrow-wide").onClick(() => this.setNoteSort("modified-asc"));
    });
    menu.addItem((item) => {
      item.setTitle(t("sort.notesPathAsc")).setIcon("folder-tree").onClick(() => this.setNoteSort("path-asc"));
    });
    menu.showAtMouseEvent(event);
  }

  private attachDragSource(element: HTMLElement, item: SelectionItem, payload: SingleDragPayload): void {
    element.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) {
        return;
      }
      event.stopPropagation();
      if (!this.selectedKeys.has(item.key)) {
        this.selectedKeys = new Set([item.key]);
        this.lastSelectedKey = item.key;
        this.syncSelectionClasses();
      }
      const dragPayload = this.dragPayloadForSelection(payload);
      this.currentDragPayload = dragPayload;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragPayload));
      event.dataTransfer.setData("text/plain", this.dragPayloadLabel(dragPayload));
      element.addClass("is-dragging");
    });
    element.addEventListener("dragend", () => {
      this.currentDragPayload = null;
      element.removeClass("is-dragging");
    });
  }

  private dragPayloadForSelection(fallback: SingleDragPayload): DragPayload {
    const selectedPayloads = Array.from(this.selectedKeys)
      .map((key) => this.selectionPayloads.get(key))
      .filter((payload): payload is SingleDragPayload => !!payload && payload.type === fallback.type);
    if (selectedPayloads.length <= 1) {
      return fallback;
    }
    return { type: "batch", items: selectedPayloads };
  }

  private dragPayloadLabel(payload: DragPayload): string {
    if (payload.type === "batch") {
      return `${payload.items.length} Tag Explorer items`;
    }
    if (payload.type === "tag") {
      return `#${payload.path}`;
    }
    return payload.filePath;
  }

  private attachTouchInteraction(element: HTMLElement, item: SelectionItem, payload: SingleDragPayload): void {
    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || !event.isPrimary) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      this.cancelTouchGesture();
      const gesture: TouchGestureState = {
        pointerId: event.pointerId,
        element,
        item,
        payload,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        selectTimer: 0,
        menuTimer: 0,
        selected: false,
        dragging: false,
        menuOpened: false,
      };
      element.addClass("is-touch-active");
      element.setPointerCapture(event.pointerId);

      gesture.selectTimer = window.setTimeout(() => {
        if (this.touchGesture !== gesture || actionForTouchSelectTimer(gesture) !== "select") {
          return;
        }
        gesture.selected = true;
        this.selectItemForTouch(item);
        this.suppressNextClick(element);
        this.vibrateTouchSelection();
      }, TOUCH_SELECT_DELAY_MS);

      gesture.menuTimer = window.setTimeout(() => {
        if (this.touchGesture !== gesture || actionForTouchMenuTimer(gesture) !== "menu") {
          return;
        }
        if (!gesture.selected) {
          gesture.selected = true;
          this.selectItemForTouch(item);
          this.vibrateTouchSelection();
        }
        gesture.menuOpened = true;
        this.suppressNextClick(element);
        element.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: gesture.lastX,
          clientY: gesture.lastY,
        }));
      }, TOUCH_MENU_DELAY_MS);

      this.touchGesture = gesture;
    });

    element.addEventListener("pointermove", (event) => {
      const gesture = this.touchGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      const action = actionForTouchMove(
        gesture,
        touchGestureDistance(gesture.startX, gesture.startY, event.clientX, event.clientY),
        { movementThreshold: TOUCH_DRAG_THRESHOLD_PX },
      );
      if (action === "cancel") {
        this.cancelTouchGesture();
        return;
      }
      if (gesture.selected) {
        event.preventDefault();
      }
      if (action === "drag") {
        window.clearTimeout(gesture.menuTimer);
        gesture.dragging = true;
        this.startTouchDrag(gesture);
      }
      if (gesture.dragging) {
        this.updateTouchDrag(event.clientX, event.clientY);
      }
    });

    element.addEventListener("pointerup", (event) => {
      const gesture = this.touchGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      if (gesture.selected || gesture.dragging || gesture.menuOpened) {
        event.preventDefault();
      }
      if (gesture.dragging) {
        void this.finishTouchDrag(event.clientX, event.clientY);
      }
      this.cancelTouchGesture();
    });

    element.addEventListener("pointercancel", (event) => {
      const gesture = this.touchGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      this.cancelTouchGesture();
    });
  }

  private startTouchDrag(gesture: TouchGestureState): void {
    if (this.touchDrag) {
      this.clearTouchDrag();
    }
    const dragPayload = this.dragPayloadForSelection(gesture.payload);
    const previewEl = activeDocument.body.createDiv({
      cls: "tag-explorer-touch-drag-preview",
      text: this.dragPayloadLabel(dragPayload),
    });
    this.currentDragPayload = dragPayload;
    gesture.element.addClass("is-dragging");
    this.touchDrag = {
      payload: dragPayload,
      sourceEl: gesture.element,
      previewEl,
      currentDropEl: null,
    };
    this.suppressNextClick(gesture.element);
    this.updateTouchDrag(gesture.lastX, gesture.lastY);
  }

  private updateTouchDrag(clientX: number, clientY: number): void {
    const drag = this.touchDrag;
    if (!drag) {
      return;
    }
    drag.previewEl.style.transform = `translate(${clientX + 12}px, ${clientY + 12}px)`;
    this.autoScrollTouchDrag(clientY);

    const dropEl = this.touchDropTargetAt(clientX, clientY, drag.payload);
    if (drag.currentDropEl && drag.currentDropEl !== dropEl) {
      drag.currentDropEl.removeClass("is-drop-target");
    }
    drag.currentDropEl = dropEl;
    dropEl?.addClass("is-drop-target");
  }

  private async finishTouchDrag(clientX: number, clientY: number): Promise<void> {
    const drag = this.touchDrag;
    if (!drag) {
      return;
    }
    const dropEl = this.touchDropTargetAt(clientX, clientY, drag.payload);
    const targetTag = dropEl?.dataset.tagExplorerDropTargetTag;
    const isRoot = dropEl?.dataset.tagExplorerDropTargetRoot === "true";
    this.clearTouchDrag();
    if (dropEl && targetTag !== undefined && this.canDrop(drag.payload, targetTag, isRoot)) {
      await this.handleDrop(drag.payload, targetTag, isRoot);
    }
  }

  private clearTouchDrag(): void {
    if (!this.touchDrag) {
      return;
    }
    this.touchDrag.currentDropEl?.removeClass("is-drop-target");
    this.touchDrag.sourceEl.removeClass("is-dragging");
    this.touchDrag.previewEl.remove();
    this.touchDrag = null;
    this.currentDragPayload = null;
  }

  private cancelTouchGesture(): void {
    const gesture = this.touchGesture;
    if (!gesture) {
      return;
    }
    window.clearTimeout(gesture.selectTimer);
    window.clearTimeout(gesture.menuTimer);
    if (gesture.element.hasPointerCapture(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }
    gesture.element.removeClass("is-touch-active");
    if (!gesture.dragging) {
      this.clearTouchDrag();
    }
    this.touchGesture = null;
  }

  private touchDropTargetAt(clientX: number, clientY: number, payload: DragPayload): HTMLElement | null {
    const hit = activeDocument.elementFromPoint(clientX, clientY);
    if (!(hit instanceof HTMLElement)) {
      return null;
    }

    const rowEl = hit.closest<HTMLElement>(".tag-explorer-row");
    const candidate = rowEl?.dataset.tagExplorerDropTarget === "true"
      ? rowEl
      : rowEl
        ? null
        : hit.closest<HTMLElement>("[data-tag-explorer-drop-target='true']");
    if (!candidate) {
      return null;
    }

    const targetTag = candidate.dataset.tagExplorerDropTargetTag;
    const isRoot = candidate.dataset.tagExplorerDropTargetRoot === "true";
    return targetTag !== undefined && this.canDrop(payload, targetTag, isRoot) ? candidate : null;
  }

  private autoScrollTouchDrag(clientY: number): void {
    if (!this.treeContainerEl) {
      return;
    }
    const rect = this.treeContainerEl.getBoundingClientRect();
    if (clientY < rect.top + TOUCH_AUTO_SCROLL_EDGE_PX) {
      this.treeContainerEl.scrollTop -= TOUCH_AUTO_SCROLL_STEP_PX;
    } else if (clientY > rect.bottom - TOUCH_AUTO_SCROLL_EDGE_PX) {
      this.treeContainerEl.scrollTop += TOUCH_AUTO_SCROLL_STEP_PX;
    }
  }

  private vibrateTouchSelection(): void {
    try {
      navigator.vibrate?.(10);
    } catch {
      // Haptics are best-effort and unavailable in some Obsidian mobile webviews.
    }
  }

  private attachDropTarget(element: HTMLElement, targetTag: string, isRoot: boolean): void {
    element.dataset.tagExplorerDropTarget = "true";
    element.dataset.tagExplorerDropTargetTag = targetTag;
    element.dataset.tagExplorerDropTargetRoot = String(isRoot);

    element.addEventListener("dragover", (event) => {
      const payload = this.readDragPayload(event);
      if (!payload || !this.canDrop(payload, targetTag, isRoot)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      element.addClass("is-drop-target");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });
    element.addEventListener("dragleave", () => {
      element.removeClass("is-drop-target");
    });
    element.addEventListener("drop", (event) => {
      const payload = this.readDragPayload(event);
      this.currentDragPayload = null;
      element.removeClass("is-drop-target");
      if (!payload || !this.canDrop(payload, targetTag, isRoot)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void this.handleDrop(payload, targetTag, isRoot);
    });
  }

  private readDragPayload(event: DragEvent): DragPayload | null {
    return resolveDragPayload(this.currentDragPayload, event.dataTransfer?.getData(DRAG_MIME));
  }

  private canDrop(payload: DragPayload, targetTag: string, isRoot: boolean): boolean {
    if (payload.type === "batch") {
      return payload.items.length > 0 && payload.items.every((item) => this.canDrop(item, targetTag, isRoot));
    }

    if (payload.type === "note") {
      return !isRoot && payload.sourceTag !== targetTag;
    }

    if (payload.type === "untagged-note") {
      return !isRoot;
    }

    if (isRoot) {
      return payload.path.includes("/");
    }

    return payload.path !== targetTag && !targetTag.startsWith(`${payload.path}/`);
  }

  private async handleDrop(payload: DragPayload, targetTag: string, isRoot: boolean): Promise<void> {
    if (payload.type === "batch") {
      await this.handleBatchDrop(payload.items, targetTag, isRoot);
      return;
    }

    if (payload.type === "note") {
      await this.plugin.moveNoteToTag(payload.filePath, payload.sourceTag, targetTag);
      return;
    }

    if (payload.type === "untagged-note") {
      await this.plugin.addUntaggedNoteToTag(payload.filePath, targetTag);
      return;
    }

    await this.plugin.moveTagToParent(payload.path, isRoot ? "" : targetTag);
  }

  private async handleBatchDrop(items: SingleDragPayload[], targetTag: string, isRoot: boolean): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const firstType = items[0].type;
    if (!items.every((item) => item.type === firstType)) {
      return;
    }

    if (firstType === "note") {
      await this.plugin.moveNotesToTag(
        items
          .filter((item): item is { type: "note"; filePath: string; sourceTag: string } => item.type === "note")
          .map((item) => ({ filePath: item.filePath, sourceTag: item.sourceTag })),
        targetTag,
      );
      return;
    }

    if (firstType === "untagged-note") {
      await this.plugin.addUntaggedNotesToTag(
        items
          .filter((item): item is { type: "untagged-note"; filePath: string } => item.type === "untagged-note")
          .map((item) => item.filePath),
        targetTag,
      );
      return;
    }

    await this.plugin.moveTagsToParent(
      items
        .filter((item): item is { type: "tag"; path: string } => item.type === "tag")
        .map((item) => item.path),
      isRoot ? "" : targetTag,
    );
  }

  private async setTagSort(value: TagTreeOptions["tagSort"]): Promise<void> {
    this.plugin.settings.tagSort = value;
    await this.plugin.saveSettingsAndRefresh();
  }

  private async setNoteSort(value: TagTreeOptions["noteSort"]): Promise<void> {
    this.plugin.settings.noteSort = value;
    await this.plugin.saveSettingsAndRefresh();
  }

  private async setSourceMode(value: "all-tags" | "properties-only"): Promise<void> {
    this.plugin.settings.tagSourceMode = value;
    await this.plugin.saveSettingsAndRefresh();
  }
}

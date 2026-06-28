import { App, Modal, Setting, SuggestModal } from "obsidian";
import { t } from "./i18n";
import type { TagOperationPlan } from "./tag-operations";

export type ConfirmVariant = "cta" | "warning";

export function promptForText(
  app: App,
  title: string,
  name: string,
  initialValue: string,
  placeholder: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    new TextPromptModal(app, title, name, initialValue, placeholder, resolve).open();
  });
}

export function confirmTagOperation(
  app: App,
  title: string,
  plan: TagOperationPlan,
  variant: ConfirmVariant = "cta",
): Promise<boolean> {
  return new Promise((resolve) => {
    new TagOperationPreviewModal(app, title, plan, variant, resolve).open();
  });
}

export function chooseParentTag(app: App, tags: string[], includeRoot = true): Promise<string | null> {
  return new Promise((resolve) => {
    new ParentTagSuggestModal(app, tags, includeRoot, resolve).open();
  });
}

export function confirmDeleteNotes(app: App, paths: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    new DeleteNotesConfirmModal(app, paths, resolve).open();
  });
}

class TextPromptModal extends Modal {
  private value: string;
  private resolved = false;

  constructor(
    app: App,
    private readonly modalTitle: string,
    private readonly settingName: string,
    initialValue: string,
    private readonly placeholder: string,
    private readonly resolve: (value: string | null) => void,
  ) {
    super(app);
    this.value = initialValue;
  }

  onOpen(): void {
    this.setTitle(this.modalTitle);
    const { contentEl } = this;
    contentEl.empty();

    let inputEl: HTMLInputElement | null = null;
    new Setting(contentEl)
      .setName(this.settingName)
      .addText((text) => {
        text
          .setPlaceholder(this.placeholder)
          .setValue(this.value)
          .onChange((value) => {
            this.value = value;
          });
        inputEl = text.inputEl;
      });

    const actionsEl = contentEl.createDiv({ cls: "tag-explorer-modal-actions" });
    new Setting(actionsEl)
      .addButton((button) => {
        button
          .setButtonText(t("modal.cancel"))
          .onClick(() => {
            this.finish(null);
          });
      })
      .addButton((button) => {
        button
          .setButtonText(t("modal.continue"))
          .setCta()
          .onClick(() => {
            this.finish(this.value);
          });
      });

    window.setTimeout(() => inputEl?.focus(), 0);
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(null);
    }
  }

  private finish(value: string | null): void {
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

class TagOperationPreviewModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly modalTitle: string,
    private readonly plan: TagOperationPlan,
    private readonly variant: ConfirmVariant,
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.modalTitle);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tag-explorer-preview-modal");

    contentEl.createEl("p", {
      text: this.plan.titleLine ?? `#${this.plan.oldPath} -> #${this.plan.newPath}`,
    });
    contentEl.createEl("p", {
      text: t("preview.summary", {
        files: this.plan.entries.length,
        properties: this.plan.totalPropertyCount,
        inline: this.plan.totalInlineCount,
        added: this.plan.tagFolderAdditions.length,
        removed: this.plan.tagFolderRemovals.length,
      }),
    });

    const listEl = contentEl.createEl("ul", { cls: "tag-explorer-preview-list" });
    for (const entry of this.plan.entries.slice(0, 20)) {
      listEl.createEl("li", {
        text: t("preview.fileEntry", {
          path: entry.path,
          properties: entry.propertyCount,
          inline: entry.inlineCount,
        }),
      });
    }
    if (this.plan.entries.length > 20) {
      listEl.createEl("li", { text: t("preview.moreFiles", { count: this.plan.entries.length - 20 }) });
    }
    for (const tagFolderPath of this.plan.tagFolderRemovals.slice(0, 20)) {
      listEl.createEl("li", { text: t("preview.removeTagFolder", { path: tagFolderPath }) });
    }
    for (const tagFolderPath of this.plan.tagFolderAdditions.slice(0, 20)) {
      listEl.createEl("li", { text: t("preview.addTagFolder", { path: tagFolderPath }) });
    }

    const actionsEl = contentEl.createDiv({ cls: "tag-explorer-modal-actions" });
    new Setting(actionsEl)
      .addButton((button) => {
        button
          .setButtonText(t("modal.cancel"))
          .onClick(() => {
            this.finish(false);
          });
      })
      .addButton((button) => {
        button
          .setButtonText(t("modal.apply"))
          .onClick(() => {
            this.finish(true);
          });
        if (this.variant === "warning") {
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- setDestructive requires Obsidian 1.13.0; the plugin supports 1.8.7.
          button.setWarning();
        } else {
          button.setCta();
        }
      });
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    this.resolved = true;
    this.resolve(confirmed);
    this.close();
  }
}

class ParentTagSuggestModal extends SuggestModal<string> {
  private resolved = false;

  constructor(
    app: App,
    private readonly tags: string[],
    private readonly includeRoot: boolean,
    private readonly resolve: (tag: string | null) => void,
  ) {
    super(app);
    this.setPlaceholder(t("modal.chooseTarget"));
    this.emptyStateText = t("modal.noMatches");
  }

  getSuggestions(query: string): string[] {
    const normalizedQuery = query.trim().toLowerCase();
    const options = this.includeRoot ? ["", ...this.tags] : this.tags;
    if (!normalizedQuery) {
      return options.slice(0, 100);
    }
    return options
      .filter((tag) => (tag || t("modal.root")).toLowerCase().includes(normalizedQuery))
      .slice(0, 100);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.createSpan({ text: value || t("modal.root") });
  }

  onChooseSuggestion(item: string): void {
    this.resolved = true;
    this.resolve(item);
    this.close();
  }

  onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      if (!this.resolved) {
        this.resolved = true;
        this.resolve(null);
      }
    }, 0);
  }
}

class DeleteNotesConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly paths: string[],
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t("modal.deleteNotes.title"));
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tag-explorer-preview-modal");

    contentEl.createEl("p", {
      text: t("modal.deleteNotes.summary", { count: this.paths.length }),
    });

    const listEl = contentEl.createEl("ul", { cls: "tag-explorer-preview-list" });
    for (const path of this.paths.slice(0, 20)) {
      listEl.createEl("li", { text: path });
    }
    if (this.paths.length > 20) {
      listEl.createEl("li", { text: t("preview.moreFiles", { count: this.paths.length - 20 }) });
    }

    const actionsEl = contentEl.createDiv({ cls: "tag-explorer-modal-actions" });
    new Setting(actionsEl)
      .addButton((button) => {
        button
          .setButtonText(t("modal.cancel"))
          .onClick(() => {
            this.finish(false);
          });
      })
      .addButton((button) => {
        button
          .setButtonText(t("modal.deleteNotes.apply"))
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- setDestructive requires Obsidian 1.13.0; the plugin supports 1.8.7.
          .setWarning()
          .onClick(() => {
            this.finish(true);
          });
      });
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    this.resolved = true;
    this.resolve(confirmed);
    this.close();
  }
}

import { App, PluginSettingTab, Setting } from "obsidian";
import { t } from "./i18n";
import { normalizeNotePaths } from "./settings";
import type TagExplorerPlugin from "./main";
import type {
  CounterMode,
  NoteSortMode,
  TagSortMode,
  TagSourceMode,
} from "./types";

export class TagExplorerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TagExplorerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("app.name"))
      .setHeading();

    new Setting(containerEl)
      .setName(t("settings.sourceMode.name"))
      .setDesc(t("settings.sourceMode.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("all-tags", t("option.allTags"))
          .addOption("properties-only", t("option.propertiesOnly"))
          .setValue(this.plugin.settings.tagSourceMode)
          .onChange(async (value) => {
            this.plugin.settings.tagSourceMode = value as TagSourceMode;
            await this.plugin.saveSettingsAndRefresh();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.counterMode.name"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("exact", t("option.exactCount"))
          .addOption("recursive", t("option.recursiveCount"))
          .setValue(this.plugin.settings.counterMode)
          .onChange(async (value) => {
            this.plugin.settings.counterMode = value as CounterMode;
            await this.plugin.saveSettingsAndRefresh();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.tagSort.name"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("name-asc", t("option.nameAsc"))
          .addOption("name-desc", t("option.nameDesc"))
          .addOption("count-desc", t("option.countDesc"))
          .addOption("count-asc", t("option.countAsc"))
          .setValue(this.plugin.settings.tagSort)
          .onChange(async (value) => {
            this.plugin.settings.tagSort = value as TagSortMode;
            await this.plugin.saveSettingsAndRefresh();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.noteSort.name"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("name-asc", t("option.nameAsc"))
          .addOption("name-desc", t("option.nameDesc"))
          .addOption("modified-desc", t("option.modifiedDesc"))
          .addOption("modified-asc", t("option.modifiedAsc"))
          .addOption("path-asc", t("option.pathAsc"))
          .setValue(this.plugin.settings.noteSort)
          .onChange(async (value) => {
            this.plugin.settings.noteSort = value as NoteSortMode;
            await this.plugin.saveSettingsAndRefresh();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.showExtension.name"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showNoteFileExtension)
          .onChange(async (value) => {
            this.plugin.settings.showNoteFileExtension = value;
            await this.plugin.saveSettingsAndRefresh();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.showPath.name"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showFullPathOnHover)
          .onChange(async (value) => {
            this.plugin.settings.showFullPathOnHover = value;
            await this.plugin.saveSettingsAndRefresh();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.showUntagged.name"))
      .setDesc(t("settings.showUntagged.desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showUntaggedSection)
          .onChange(async (value) => {
            this.plugin.settings.showUntaggedSection = value;
            await this.plugin.saveSettingsAndRefresh();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.excludedNotes.name"))
      .setDesc(t("settings.excludedNotes.desc"))
      .addTextArea((text) => {
        text
          .setPlaceholder(t("settings.excludedNotes.placeholder"))
          .setValue(this.plugin.settings.excludedNotePaths.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludedNotePaths = normalizeNotePaths(value.split(/\r?\n/));
            await this.plugin.saveSettingsAndRefresh();
          });
        text.inputEl.rows = 5;
      });

    new Setting(containerEl)
      .setName(t("settings.persistExpanded.name"))
      .setDesc(t("settings.persistExpanded.desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.persistExpandedTags)
          .onChange(async (value) => {
            this.plugin.settings.persistExpandedTags = value;
            if (!value) {
              this.plugin.settings.expandedTags = [];
            }
            await this.plugin.saveSettingsAndRefresh();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.experimentalSearch.name"))
      .setDesc(t("settings.experimentalSearch.desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.experimentalOpenSearch)
          .onChange(async (value) => {
            this.plugin.settings.experimentalOpenSearch = value;
            await this.plugin.saveSettingsAndRefresh();
          });
      });
  }
}

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { translateForTest } from "../src/i18n";
import { normalizeSettingsData } from "../src/settings";

describe("settings migration", () => {
  it("shows untagged section by default for fresh settings", () => {
    assert.equal(normalizeSettingsData(null).showUntaggedSection, true);
  });

  it("preserves explicit untagged setting and migrates virtual folders to tag-folders", () => {
    const settings = normalizeSettingsData({
      showUntaggedSection: false,
      virtualFolders: ["work/project"],
      tagFolders: ["work/project", "archive"],
      parentNotesMode: "include-children",
    });

    assert.equal(settings.showUntaggedSection, false);
    assert.deepEqual(settings.tagFolders, ["work/project", "archive"]);
    assert.equal("virtualFolders" in settings, false);
    assert.equal("parentNotesMode" in settings, false);
  });
});

describe("i18n", () => {
  it("looks up Russian strings and falls back to English", () => {
    assert.equal(translateForTest("tree.untagged", "ru"), "Без тегов");
    assert.equal(translateForTest("menu.renameNote", "ru"), "Переименовать заметку");
    assert.equal(translateForTest("menu.openToRight", "ru"), "Открыть справа");
    assert.equal(translateForTest("menu.deleteNote", "en"), "Delete note");
    assert.equal(translateForTest("tree.untagged", "de"), "Untagged");
    assert.equal(translateForTest("missing.key", "ru"), "missing.key");
  });
});

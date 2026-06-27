import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  canDeleteTagFolderSubtree,
  countForNode,
  createTagTree,
  extractPropertyTags,
  normalizeTag,
  normalizeTags,
  toRenderableTree,
} from "../src/tag-index";
import type { IndexedNote } from "../src/types";

const baseOptions = {
  counterMode: "recursive" as const,
  tagSort: "name-asc" as const,
  noteSort: "name-asc" as const,
};

function note(path: string, tags: string[], mtime = 1): IndexedNote {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    basename: name.replace(/\.md$/i, ""),
    extension: "md",
    mtime,
    tags,
  };
}

describe("tag normalization", () => {
  it("normalizes hashes, spacing, nested separators, and duplicates", () => {
    assert.equal(normalizeTag(" #work/[ORG]/backend "), "work/[ORG]/backend");
    assert.equal(normalizeTag("///"), null);
    assert.deepEqual(normalizeTags(["#a/b", "a/b", " a / c "]), ["a/b", "a/c"]);
  });

  it("extracts property tags from supported YAML shapes", () => {
    assert.deepEqual(extractPropertyTags(["work/[ORG]", "#pc/disk", "", null]), ["work/[ORG]", "pc/disk"]);
    assert.deepEqual(extractPropertyTags("work/project"), ["work/project"]);
    assert.deepEqual(extractPropertyTags(undefined), []);
  });
});

describe("tag tree", () => {
  it("builds nested tag hierarchy and exact notes", () => {
    const tree = createTagTree([
      note("Project plan.md", ["work/[ORG]/backend"]),
    ], [], baseOptions);

    const work = tree.children[0];
    const org = work.children[0];
    const backend = org.children[0];

    assert.equal(work.path, "work");
    assert.equal(org.path, "work/[ORG]");
    assert.equal(backend.path, "work/[ORG]/backend");
    assert.deepEqual(backend.exactNotes.map((item) => item.basename), ["Project plan"]);
  });

  it("keeps parent notes exact by default and computes recursive counts", () => {
    const tree = createTagTree([
      note("A.md", ["work"]),
      note("B.md", ["work/backend"]),
    ], [], baseOptions);

    const work = tree.children[0];
    assert.deepEqual(work.exactNotes.map((item) => item.basename), ["A"]);
    assert.deepEqual(work.recursiveNotes.map((item) => item.basename), ["A", "B"]);
    assert.equal(countForNode(work, "exact"), 1);
    assert.equal(countForNode(work, "recursive"), 2);
  });

  it("does not show child notes in parent display", () => {
    const tree = createTagTree([
      note("A.md", ["work", "work/backend"]),
    ], [], baseOptions);
    const nodes = toRenderableTree(tree, baseOptions, "");

    assert.deepEqual(nodes[0].notes.map((item) => item.path), ["A.md"]);
  });

  it("supports all-tags versus properties-only behavior through input tags", () => {
    const propertiesOnly = createTagTree([
      note("Mixed.md", ["work/project"]),
    ], [], baseOptions);
    const allTags = createTagTree([
      note("Mixed.md", ["work/project", "home/todo"]),
    ], [], baseOptions);

    assert.deepEqual(propertiesOnly.children.map((item) => item.name), ["work"]);
    assert.deepEqual(allTags.children.map((item) => item.name), ["home", "work"]);
  });

  it("filters by note path while keeping parent tags visible", () => {
    const tree = createTagTree([
      note("Projects/API notes.md", ["work/[ORG]/backend"]),
      note("Archive/Other.md", ["personal/archive"]),
    ], [], baseOptions);
    const nodes = toRenderableTree(tree, baseOptions, "api");

    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].node.path, "work");
    assert.deepEqual(nodes[0].children[0].children[0].notes.map((item) => item.basename), ["API notes"]);
  });

  it("sorts tags by recursive count and notes by modified time", () => {
    const tree = createTagTree([
      note("Old.md", ["b"], 1),
      note("New.md", ["b"], 3),
      note("Single.md", ["a"], 2),
    ], [], {
      ...baseOptions,
      tagSort: "count-desc",
      noteSort: "modified-desc",
    });

    assert.deepEqual(tree.children.map((item) => item.name), ["b", "a"]);
    assert.deepEqual(tree.children[0].exactNotes.map((item) => item.basename), ["New", "Old"]);
  });

  it("merges tag-folders into the real tree and dedupes real paths", () => {
    const tree = createTagTree([
      note("A.md", ["work/project"]),
    ], ["work/project", "empty/child"], baseOptions);

    const work = tree.children.find((item) => item.path === "work");
    const empty = tree.children.find((item) => item.path === "empty");

    assert.equal(work?.children[0].path, "work/project");
    assert.equal(work?.children[0].isTagFolder, true);
    assert.equal(work?.children[0].hasRealTag, true);
    assert.equal(empty?.children[0].tagFolderOnly, true);
    assert.equal(canDeleteTagFolderSubtree(empty?.children[0]!), true);
  });
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  addPropertyTag,
  isInvalidMoveTarget,
  normalizeTagMoveSources,
  remapTagFolders,
  removePropertyTag,
  resolveMoveTarget,
  resolveRenameTarget,
  rewriteInlineTags,
  rewritePropertyTags,
} from "../src/tag-operations";

describe("tag operation targets", () => {
  it("renames the current segment when the input has no slash", () => {
    assert.equal(resolveRenameTarget("work/project/backend", "api"), "work/project/api");
  });

  it("allows full path rename when the input contains slash", () => {
    assert.equal(resolveRenameTarget("work/project", "archive/project"), "archive/project");
  });

  it("moves a tag under root or an existing parent", () => {
    assert.equal(resolveMoveTarget("work/project", ""), "project");
    assert.equal(resolveMoveTarget("work/project", "archive"), "archive/project");
  });

  it("rejects moves into the same subtree", () => {
    assert.equal(resolveMoveTarget("work/project", "work/project/backend"), null);
    assert.equal(isInvalidMoveTarget("work/project", "work/project/backend"), true);
  });
});

describe("frontmatter tag rewrite", () => {
  it("rewrites subtree tags and removes duplicates", () => {
    const result = rewritePropertyTags(
      ["work/project", "work/project/backend", "archive/project"],
      "work/project",
      "archive/project",
    );

    assert.equal(result.changed, true);
    assert.equal(result.count, 2);
    assert.deepEqual(result.value, ["archive/project", "archive/project/backend"]);
  });

  it("preserves scalar tag shape", () => {
    const result = rewritePropertyTags("work/project", "work/project", "archive/project");

    assert.equal(result.changed, true);
    assert.equal(result.value, "archive/project");
  });

  it("exact mode replaces only the note source tag", () => {
    const result = rewritePropertyTags(
      ["work/project", "work/project/backend"],
      "work/project",
      "archive/project",
      "exact",
    );

    assert.deepEqual(result.value, ["archive/project", "work/project/backend"]);
  });
});

describe("property tag add and remove", () => {
  it("adds tag to empty, scalar, and list values", () => {
    assert.deepEqual(addPropertyTag(undefined, "work/project").value, ["work/project"]);
    assert.deepEqual(addPropertyTag("personal", "work/project").value, ["personal", "work/project"]);
    assert.deepEqual(addPropertyTag(["personal"], "work/project").value, ["personal", "work/project"]);
  });

  it("does not duplicate existing tags", () => {
    const result = addPropertyTag(["work/project"], "#work/project");

    assert.equal(result.changed, false);
    assert.deepEqual(result.value, ["work/project"]);
  });

  it("removes only the requested tag", () => {
    const result = removePropertyTag(["personal", "work/project"], "work/project");

    assert.equal(result.changed, true);
    assert.deepEqual(result.value, ["personal"]);
  });
});

describe("inline tag rewrite", () => {
  it("rewrites only Obsidian cache positions outside frontmatter", () => {
    const content = [
      "---",
      "tags:",
      "  - work/project",
      "---",
      "Keep plain work/project text.",
      "Change #work/project and #work/project/backend.",
    ].join("\n");

    const firstInlineStart = content.indexOf("#work/project");
    const secondInlineStart = content.indexOf("#work/project/backend");
    const result = rewriteInlineTags(
      content,
      [
        {
          tag: "#work/project",
          position: {
            start: { line: 2, col: 4, offset: 0 },
            end: { line: 2, col: 16, offset: 0 },
          },
        },
        {
          tag: "#work/project",
          position: locFromOffset(content, firstInlineStart, "#work/project".length),
        },
        {
          tag: "#work/project/backend",
          position: locFromOffset(content, secondInlineStart, "#work/project/backend".length),
        },
      ],
      "work/project",
      "archive/project",
      3,
    );

    assert.equal(result.count, 2);
    assert.equal(result.content.includes("Keep plain work/project text."), true);
    assert.equal(result.content.includes("#archive/project and #archive/project/backend"), true);
    assert.equal(result.content.includes("  - work/project"), true);
  });

  it("exact mode does not rewrite child inline tags", () => {
    const content = "Change #work/project and keep #work/project/backend.";
    const firstInlineStart = content.indexOf("#work/project");
    const secondInlineStart = content.indexOf("#work/project/backend");
    const result = rewriteInlineTags(
      content,
      [
        {
          tag: "#work/project",
          position: locFromOffset(content, firstInlineStart, "#work/project".length),
        },
        {
          tag: "#work/project/backend",
          position: locFromOffset(content, secondInlineStart, "#work/project/backend".length),
        },
      ],
      "work/project",
      "archive/project",
      null,
      "exact",
    );

    assert.equal(result.count, 1);
    assert.equal(result.content, "Change #archive/project and keep #work/project/backend.");
  });
});

describe("tag-folder remap", () => {
  it("moves tag-folder subtree with tag subtree operation", () => {
    assert.deepEqual(
      remapTagFolders(["work/project", "work/project/child", "other"], "work/project", "archive/project"),
      ["archive/project", "archive/project/child", "other"],
    );
  });
});

describe("tag move source normalization", () => {
  it("drops descendant selections when their parent is already selected", () => {
    assert.deepEqual(
      normalizeTagMoveSources(["work/project/backend", "work/project", "other"]),
      ["other", "work/project"],
    );
  });
});

function locFromOffset(content: string, start: number, length: number) {
  const startLoc = locAt(content, start);
  const endLoc = locAt(content, start + length);
  return { start: startLoc, end: endLoc };
}

function locAt(content: string, offset: number) {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length - 1,
    col: lines[lines.length - 1].length,
    offset,
  };
}

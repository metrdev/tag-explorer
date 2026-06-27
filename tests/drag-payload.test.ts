import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  parseDragPayload,
  resolveDragPayload,
  type DragPayload,
} from "../src/drag-payload";

describe("drag payload resolver", () => {
  it("uses in-memory payload when dataTransfer payload is unavailable", () => {
    const memoryPayload: DragPayload = { type: "tag", path: "example/project" };

    assert.deepEqual(resolveDragPayload(memoryPayload, ""), memoryPayload);
  });

  it("parses valid custom dataTransfer payload", () => {
    assert.deepEqual(
      parseDragPayload(JSON.stringify({
        type: "batch",
        items: [
          { type: "note", filePath: "A.md", sourceTag: "example/project" },
          { type: "note", filePath: "B.md", sourceTag: "example/project" },
        ],
      })),
      {
        type: "batch",
        items: [
          { type: "note", filePath: "A.md", sourceTag: "example/project" },
          { type: "note", filePath: "B.md", sourceTag: "example/project" },
        ],
      },
    );
  });

  it("rejects invalid payloads", () => {
    assert.equal(parseDragPayload(JSON.stringify({ type: "tag" })), null);
    assert.equal(parseDragPayload("not-json"), null);
  });
});

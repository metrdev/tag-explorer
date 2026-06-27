import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { confirmVariantForAction } from "../src/confirm-variant";

describe("confirm variant policy", () => {
  it("uses accent CTA for non-destructive confirmations and warning for delete", () => {
    assert.equal(confirmVariantForAction("default"), "cta");
    assert.equal(confirmVariantForAction("delete"), "warning");
  });
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { shouldConfirmOperation } from "../src/operation-confirmation";

describe("operation confirmation policy", () => {
  it("confirms operations by default", () => {
    assert.equal(shouldConfirmOperation(), true);
    assert.equal(shouldConfirmOperation({}), true);
    assert.equal(shouldConfirmOperation({ confirm: true }), true);
  });

  it("skips confirmation only when explicitly disabled", () => {
    assert.equal(shouldConfirmOperation({ confirm: false }), false);
  });
});

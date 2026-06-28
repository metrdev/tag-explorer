import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  actionForTouchMenuTimer,
  actionForTouchMove,
  actionForTouchSelectTimer,
  touchGestureDistance,
  type TouchGestureState,
} from "../src/touch-gesture";

function state(values: Partial<TouchGestureState> = {}): TouchGestureState {
  return {
    selected: false,
    dragging: false,
    menuOpened: false,
    ...values,
  };
}

describe("touch gesture reducer", () => {
  it("selects on the long-press selection timer", () => {
    assert.equal(actionForTouchSelectTimer(state()), "select");
    assert.equal(actionForTouchSelectTimer(state({ selected: true })), "none");
  });

  it("opens context menu when held without dragging", () => {
    assert.equal(actionForTouchMenuTimer(state({ selected: true })), "menu");
    assert.equal(actionForTouchMenuTimer(state({ dragging: true })), "none");
  });

  it("starts drag only after selection and movement threshold", () => {
    assert.equal(actionForTouchMove(state(), 12, { movementThreshold: 9 }), "cancel");
    assert.equal(actionForTouchMove(state({ selected: true }), 4, { movementThreshold: 9 }), "none");
    assert.equal(actionForTouchMove(state({ selected: true }), 12, { movementThreshold: 9 }), "drag");
  });

  it("calculates pointer distance", () => {
    assert.equal(touchGestureDistance(10, 10, 16, 18), 10);
  });
});

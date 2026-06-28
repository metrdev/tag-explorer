export type TouchGestureAction = "none" | "select" | "menu" | "drag" | "cancel";

export interface TouchGestureState {
  selected: boolean;
  dragging: boolean;
  menuOpened: boolean;
}

export interface TouchGestureOptions {
  movementThreshold: number;
}

export function touchGestureDistance(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): number {
  return Math.hypot(currentX - startX, currentY - startY);
}

export function actionForTouchSelectTimer(state: TouchGestureState): TouchGestureAction {
  return state.selected || state.dragging || state.menuOpened ? "none" : "select";
}

export function actionForTouchMenuTimer(state: TouchGestureState): TouchGestureAction {
  return state.dragging || state.menuOpened ? "none" : "menu";
}

export function actionForTouchMove(
  state: TouchGestureState,
  distance: number,
  options: TouchGestureOptions,
): TouchGestureAction {
  if (state.dragging || state.menuOpened) {
    return "none";
  }
  if (distance < options.movementThreshold) {
    return "none";
  }
  return state.selected ? "drag" : "cancel";
}

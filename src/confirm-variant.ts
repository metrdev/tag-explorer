import type { ConfirmVariant } from "./modals";

export type ConfirmActionKind = "delete" | "default";

export function confirmVariantForAction(kind: ConfirmActionKind): ConfirmVariant {
  return kind === "delete" ? "warning" : "cta";
}

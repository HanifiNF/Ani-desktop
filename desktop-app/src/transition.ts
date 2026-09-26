import type { CSSProperties } from "react";
import { flushSync } from "react-dom";

/** The furthest a staggered entrance waits, in list positions, so long lists finish with the first screenful. */
export const stagger = (index: number, cap: number) => ({ "--i": Math.min(Math.max(index, 0), cap) }) as CSSProperties;

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Apply a state change inside a view transition when the platform offers one and motion is welcome. */
export function withTransition(update: () => void): void {
  const doc = document as TransitionDocument;
  if (!doc.startViewTransition || reducedMotion()) { update(); return; }
  doc.startViewTransition(() => flushSync(update));
}

/** Start a script animation when the platform offers one and motion is welcome; without one, the caller applies its change at once. */
export function play(element: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | undefined {
  if (!element || typeof element.animate !== "function" || reducedMotion()) return undefined;
  return element.animate(keyframes, options);
}

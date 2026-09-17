// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SUBTITLE_APPEARANCE } from "../shared/subtitle-appearance";
import { SubtitleAppearanceEditor } from "../src/SubtitleAppearanceEditor";

const container = document.createElement("div");
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  root = createRoot(container);
});

it("previews Unicode and multiline captions, edits the preset, and resets it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.append(container);
  const change = vi.fn();
  await act(async () => root.render(<SubtitleAppearanceEditor value={DEFAULT_SUBTITLE_APPEARANCE} onChange={change} noTrack />));
  expect(container.querySelector(".subtitle-sample")?.textContent).toContain("字幕");
  expect(container.querySelector(".subtitle-sample br")).not.toBeNull();
  expect(container.textContent).toContain("Subtitles burned into the picture cannot be customized");
  const noBackground = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(noBackground.checked).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[type="range"][max="100"]')?.disabled).toBe(true);
  await act(async () => { noBackground.click(); });
  expect(change).toHaveBeenCalledWith({ ...DEFAULT_SUBTITLE_APPEARANCE, backgroundEnabled: true });
  const size = container.querySelector<HTMLInputElement>('input[type="range"][max="200"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(size, "150");
    size.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(change).toHaveBeenCalledWith({ ...DEFAULT_SUBTITLE_APPEARANCE, size: 150 });
  await act(async () => { container.querySelector<HTMLButtonElement>(".subtitle-editor button")!.click(); });
  expect(change).toHaveBeenCalledWith(DEFAULT_SUBTITLE_APPEARANCE);
  vi.unstubAllGlobals();
});

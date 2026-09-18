// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SUBTITLE_APPEARANCE } from "../shared/subtitle-appearance";
import { SubtitleAppearanceEditor, SubtitleAppearanceRow, subtitleSummary } from "../src/SubtitleAppearanceEditor";

const container = document.createElement("div");
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  root = createRoot(container);
});

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

it("edits the preset with chips, steppers, and colour picks, and resets it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.append(container);
  const change = vi.fn();
  await act(async () => root.render(<SubtitleAppearanceEditor value={DEFAULT_SUBTITLE_APPEARANCE} onChange={change} note="No track yet." />));
  expect(container.textContent).toContain("No track yet.");
  // Background controls wait on the switch.
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Background colour"]')!.disabled).toBe(true);
  expect(button("Increase background opacity").disabled).toBe(true);
  await act(async () => { container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Subtitle background"]')!.click(); });
  expect(change).toHaveBeenLastCalledWith({ ...DEFAULT_SUBTITLE_APPEARANCE, backgroundEnabled: true });
  await act(async () => { button("Increase subtitle size").click(); });
  expect(change).toHaveBeenLastCalledWith({ ...DEFAULT_SUBTITLE_APPEARANCE, size: 110 });
  await act(async () => { button("yellow").click(); });
  expect(change).toHaveBeenLastCalledWith({ ...DEFAULT_SUBTITLE_APPEARANCE, textColor: "#f5e663" });
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((node) => node.textContent === "shadow")!.click(); });
  expect(change).toHaveBeenLastCalledWith({ ...DEFAULT_SUBTITLE_APPEARANCE, edge: "shadow" });
  await act(async () => { button("Increase subtitle offset").click(); });
  expect(change).toHaveBeenLastCalledWith({ ...DEFAULT_SUBTITLE_APPEARANCE, bottomInset: 5 });
  // Reset only offers itself once something differs from the defaults.
  const reset = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "reset")!;
  expect(reset.disabled).toBe(true);
  await act(async () => root.render(<SubtitleAppearanceEditor value={{ ...DEFAULT_SUBTITLE_APPEARANCE, size: 150, bottomInset: 3 }} onChange={change} />));
  expect(reset.disabled).toBe(false);
  // A value off the step moves to the next step.
  await act(async () => { button("Increase subtitle offset").click(); });
  expect(change).toHaveBeenLastCalledWith({ ...DEFAULT_SUBTITLE_APPEARANCE, size: 150, bottomInset: 5 });
  await act(async () => { reset.click(); });
  expect(change).toHaveBeenLastCalledWith(DEFAULT_SUBTITLE_APPEARANCE);
  vi.unstubAllGlobals();
});

it("summarises the preset on the closed row beside a live sample", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.append(container);
  const toggle = vi.fn();
  const value = { ...DEFAULT_SUBTITLE_APPEARANCE, font: "mono" as const, backgroundEnabled: true, backgroundOpacity: 40 };
  expect(subtitleSummary(value)).toBe("mono · 100% · outline · background 40%");
  await act(async () => root.render(<SubtitleAppearanceRow value={value} open={false} onToggle={toggle} />));
  const row = container.querySelector<HTMLButtonElement>(".subtitle-row")!;
  expect(row.getAttribute("aria-expanded")).toBe("false");
  expect(row.textContent).toContain("mono · 100% · outline · background 40%");
  expect(row.querySelector(".subtitle-thumb .subtitle-sample")?.textContent).toContain("字幕");
  await act(async () => { row.click(); });
  expect(toggle).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

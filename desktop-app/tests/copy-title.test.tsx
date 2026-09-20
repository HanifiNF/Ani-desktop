// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopyTitle from "../src/CopyTitle";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("CopyTitle", () => {
  it("copies the title, confirms for two seconds, and leaves the heading text alone", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    window.aniDesktop = { copyText: writeText } as unknown as typeof window.aniDesktop;
    await act(async () => root.render(<h1>Frieren<CopyTitle title="Frieren" /></h1>));
    const button = container.querySelector<HTMLButtonElement>(".copy-title")!;
    expect(container.querySelector("h1")?.textContent).toBe("Frieren");
    expect(button.dataset.tip).toBe("Copy title");
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith("Frieren");
    expect(button.dataset.tip).toBe("Copied");
    expect(button.querySelector(".icon-check")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(button.dataset.tip).toBe("Copy title");
    expect(button.querySelector(".icon-copy")).not.toBeNull();
    vi.useRealTimers();
  });
});

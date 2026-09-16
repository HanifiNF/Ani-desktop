// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmptyLibrary from "../src/EmptyLibrary";
import { Backdrop } from "../src/Backdrop";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("empty library", () => {
  it("keeps the shape of a full row: a heading, an action tile, and ghost posters", async () => {
    const onAction = vi.fn();
    await act(async () => root.render(<EmptyLibrary kind="home" onAction={onAction} />));
    expect(container.querySelector("h2")?.textContent).toBe("Continue watching");
    expect(container.querySelectorAll(".ghost")).toHaveLength(7);
    const tile = container.querySelector<HTMLButtonElement>(".start-tile");
    expect(tile?.textContent).toBe("Search anime");
    tile?.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".ghost-note")).toBeNull();
  });

  it("explains saved and recent pages under the row", async () => {
    await act(async () => root.render(<EmptyLibrary kind="saved" onAction={() => undefined} />));
    expect(container.querySelector(".start-tile")?.textContent).toBe("Save a series");
    expect(container.querySelector(".ghost-note")?.textContent).toContain("Nothing saved yet");
    await act(async () => root.render(<EmptyLibrary kind="recent" onAction={() => undefined} />));
    expect(container.querySelector(".start-tile")?.textContent).toBe("Play something");
    expect(container.querySelector(".ghost-note")?.textContent).toContain("Nothing watched yet");
  });

  it("renders the illustration behind the page in the chosen placement", async () => {
    const art = { id: 2, kind: "portrait" as const, src: "data:image/webp;base64,", light: true };
    await act(async () => root.render(<Backdrop art={art} variant="corner" />));
    const backdrop = container.querySelector(".backdrop");
    expect(backdrop?.classList.contains("backdrop-corner")).toBe(true);
    expect(backdrop?.classList.contains("is-light")).toBe(true);
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.querySelector("img")?.getAttribute("src")).toBe(art.src);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNotice, UpdatePanel, updatePending } from "../src/UpdateUI";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("update UI", () => {
  it("links to the Updates row from the Settings heading until the version is skipped", async () => {
    const jump = vi.fn();
    await act(async () => root.render(<UpdateNotice status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available" }} onJump={jump} />));
    expect(container.textContent).toContain("v1.1.0 available");
    await act(async () => container.querySelector<HTMLButtonElement>(".update-notice")!.click());
    expect(jump).toHaveBeenCalledOnce();
    expect(updatePending({ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available" })).toBe(true);

    await act(async () => root.render(<UpdateNotice status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", dismissed: true }} onJump={jump} />));
    expect(container.querySelector(".update-notice")).toBeNull();
    expect(updatePending({ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", dismissed: true })).toBe(false);
    expect(updatePending({ currentVersion: "1.0.0", state: "current" })).toBe(false);
  });

  it("offers the release and a skip in the Updates row", async () => {
    const check = vi.fn(), open = vi.fn(), skip = vi.fn();
    const click = (label: string) => act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === label)!.click());
    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", checkedAt: 1 }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect(container.textContent).toContain("Version 1.1.0 is available");
    expect(container.textContent).toContain("You have 1.0.0");
    await click("View release"); await click("skip this version"); await click("check again");
    expect(open).toHaveBeenCalledOnce(); expect(skip).toHaveBeenCalledOnce(); expect(check).toHaveBeenCalledOnce();

    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", dismissed: true }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["check again", "View release"]);
    expect(container.textContent).toContain("skipped");
  });

  it("shows current, stale, error, and development states in Settings", async () => {
    const check = vi.fn(), open = vi.fn(), skip = vi.fn();
    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.0.0", state: "current", checkedAt: 1 }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect(container.textContent).toContain("up to date");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "check now")!.click());
    expect(check).toHaveBeenCalledOnce();

    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", stale: true, error: "Could not check for updates" }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect(container.textContent).toContain("Showing the last valid result");
    expect(container.textContent).toContain("Could not check for updates");

    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", state: "development" }} checking={false} onCheck={check} onOpen={open} onSkip={skip} />));
    expect(container.textContent).toContain("disabled while running from source");
  });
});

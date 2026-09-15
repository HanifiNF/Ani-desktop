// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner, UpdatePanel } from "../src/UpdateUI";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("update UI", () => {
  it("offers a release and lets the user defer its reminder", async () => {
    const open = vi.fn(), dismiss = vi.fn();
    await act(async () => root.render(<UpdateBanner status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available" }} onOpen={open} onDismiss={dismiss} />));
    expect(container.textContent).toContain("ANIdesktop v1.1.0 is available");
    await act(async () => container.querySelector<HTMLButtonElement>(".primary")!.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Later")!.click());
    expect(open).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce();

    await act(async () => root.render(<UpdateBanner status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", dismissed: true }} onOpen={open} onDismiss={dismiss} />));
    expect(container.querySelector(".update-banner")).toBeNull();
  });

  it("shows current, stale, error, and development states in Settings", async () => {
    const check = vi.fn(), open = vi.fn();
    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.0.0", state: "current", checkedAt: 1 }} checking={false} onCheck={check} onOpen={open} />));
    expect(container.textContent).toContain("up to date");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "check now")!.click());
    expect(check).toHaveBeenCalledOnce();

    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available", stale: true, error: "Could not check for updates" }} checking={false} onCheck={check} onOpen={open} />));
    expect(container.textContent).toContain("Showing the last valid result");
    expect(container.textContent).toContain("Could not check for updates");

    await act(async () => root.render(<UpdatePanel status={{ currentVersion: "1.0.0", state: "development" }} checking={false} onCheck={check} onOpen={open} />));
    expect(container.textContent).toContain("disabled while running from source");
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutPage, ContactPage, SiteFooter } from "../src/SitePages";
import { CREATORS } from "../src/creators";

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

describe("informational pages", () => {
  it("describes the app and credits both creators", async () => {
    await act(async () => root.render(<AboutPage />));
    expect(container.textContent).toContain("cross-platform");
    expect(container.textContent).toContain("Hanifi");
    expect(container.textContent).toContain("Pascal");
    expect(container.textContent).toContain("A huge thank you to ani-cli");
    expect(container.querySelector('a[href="https://github.com/pystardust/ani-cli"]')).not.toBeNull();
    expect(container.textContent).toContain("does not host streamed media");
  });

  it("shows configured contact links and falls back to initials", async () => {
    await act(async () => root.render(<ContactPage />));
    expect([...container.querySelectorAll(".creator-card h2")].map((node) => node.textContent)).toEqual(["Hanifi", "Pascal"]);
    expect(container.querySelector<HTMLAnchorElement>('a[href="https://github.com/HanifiNF"]')?.target).toBe("_blank");
    expect(container.querySelector('a[href="mailto:hanifisetiawan@gmail.com"]')).not.toBeNull();
    expect(container.querySelectorAll('a[href^="mailto:"]')).toHaveLength(CREATORS.filter((creator) => creator.email).length);
    expect([...container.querySelectorAll(".selectable")].map((node) => node.textContent)).toEqual(["hnf_fury", "passpspsps"]);
    expect(container.querySelectorAll(".icon-github")).toHaveLength(2);
    expect(container.querySelectorAll(".icon-discord")).toHaveLength(2);
    expect(container.querySelectorAll(".icon-instagram")).toHaveLength(2);
    expect(container.querySelectorAll(".icon-mail")).toHaveLength(CREATORS.filter((creator) => creator.email).length);

    await act(async () => {
      for (const image of container.querySelectorAll("img")) image.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector('[aria-label="Hanifi portrait placeholder"]')?.textContent).toBe("H");
    expect(container.querySelector('[aria-label="Pascal portrait placeholder"]')?.textContent).toBe("P");
  });

  it("navigates through the footer and marks the current page", async () => {
    const navigate = vi.fn();
    await act(async () => root.render(<SiteFooter current="about" onNavigate={navigate} />));
    expect(container.querySelector('button[aria-current="page"]')?.textContent).toBe("About");
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Contact")?.click();
    });
    expect(navigate).toHaveBeenCalledWith("contact");
  });
});

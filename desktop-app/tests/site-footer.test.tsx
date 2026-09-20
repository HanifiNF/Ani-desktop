// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANI_CLI_AUTHOR_URL, ANI_CLI_URL, SOURCE_URL, SiteFooter } from "../src/SiteFooter";
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

describe("site footer", () => {
  it("credits the backdrop art at the end of the foot line when a page has one", async () => {
    const art = { id: 1, kind: "wide" as const, src: "data:image/webp;base64,", sourceUrl: "https://danbooru.donmai.us/post/show/1", artist: "xilmo" };
    await act(async () => root.render(<SiteFooter current="saved" onNavigate={() => undefined} backdrop={art} />));
    const credit = container.querySelector(".footer-foot .backdrop-credit");
    expect(credit?.textContent).toContain("art via nekosapi.com");
    expect(credit?.textContent).toContain("xilmo");
    expect(credit?.querySelector<HTMLAnchorElement>(`a[href="${art.sourceUrl}"]`)?.target).toBe("_blank");
    await act(async () => root.render(<SiteFooter current="settings" onNavigate={() => undefined} />));
    expect(container.querySelector(".backdrop-credit")).toBeNull();
  });
  it("describes the app, credits ani-cli, and links the source", async () => {
    await act(async () => root.render(<SiteFooter current="home" onNavigate={() => undefined} />));
    expect(container.textContent).toContain("Browse and watch anime");
    expect(container.querySelector(".footer-credit")?.textContent).toContain("Built on ani-cli by pystardust");
    expect(container.querySelector<HTMLAnchorElement>(`a[href="${ANI_CLI_URL}"]`)?.target).toBe("_blank");
    expect(container.querySelector(`a[href="${ANI_CLI_AUTHOR_URL}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="${SOURCE_URL}"]`)).not.toBeNull();
    expect(container.textContent).toContain("does not host streamed media");
  });

  it("navigates between app screens and marks the current one", async () => {
    const navigate = vi.fn();
    await act(async () => root.render(<SiteFooter current="saved" onNavigate={navigate} />));
    expect(container.querySelector('.footer-link[aria-current="page"]')?.textContent).toBe("Saved");
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".footer-link")].find((button) => button.textContent === "Settings")?.click();
    });
    expect(navigate).toHaveBeenCalledWith("settings");
    await act(async () => { container.querySelector<HTMLButtonElement>(".footer-logo")?.click(); });
    expect(navigate).toHaveBeenCalledWith("home");
  });

  it("lists every creator with their channels and falls back to initials", async () => {
    await act(async () => root.render(<SiteFooter current={undefined} onNavigate={() => undefined} />));
    expect([...container.querySelectorAll(".creator b")].map((node) => node.textContent)).toEqual(["Hanifi", "Pascal"]);
    expect(container.querySelector<HTMLAnchorElement>('a[href="https://github.com/HanifiNF"]')?.target).toBe("_blank");
    expect(container.querySelectorAll('a[href^="mailto:"]')).toHaveLength(CREATORS.filter((creator) => creator.email).length);
    expect(container.querySelectorAll(".creator-socials .icon-github")).toHaveLength(2);
    expect(container.querySelectorAll(".creator-socials .icon-instagram")).toHaveLength(2);
    expect(container.querySelectorAll(".creator-socials .icon-discord")).toHaveLength(2);

    await act(async () => {
      for (const image of container.querySelectorAll("img")) image.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector('[aria-label="Hanifi portrait placeholder"]')?.textContent).toBe("H");
    expect(container.querySelector('[aria-label="Pascal portrait placeholder"]')?.textContent).toBe("P");
  });

  it("copies a Discord handle and confirms briefly", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    window.aniDesktop = { copyText: writeText } as unknown as typeof window.aniDesktop;
    await act(async () => root.render(<SiteFooter current={undefined} onNavigate={() => undefined} />));
    const button = container.querySelector<HTMLButtonElement>('.creator-socials button[title^="Discord"]')!;
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith("hnf_fury");
    expect(container.querySelector(".copied-tip")?.textContent).toBe("Copied");
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(container.querySelector(".copied-tip")).toBeNull();
    vi.useRealTimers();
  });
});

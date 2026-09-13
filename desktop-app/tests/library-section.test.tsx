// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LibrarySection from "../src/LibrarySection";
import type { LibraryEntry } from "../shared/contracts";

describe("library progress badges", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const entry: LibraryEntry = { animeId: "aniwave:show-1", title: "Show", lastEpisode: "11", mode: "sub", updatedAt: new Date().toISOString(), completed: false, lastProvider: "aniwave",
    sources: [{ id: "aniwave:show-1", provider: "aniwave", title: "Show", aliases: ["Show"] }], progressByProvider: { aniwave: { lastEpisode: "11", mode: "sub", updatedAt: new Date().toISOString() } } };

  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("shows watched over available and never increments progress for the next scheduled episode", async () => {
    const props = { kind: "continue" as const, heading: "Continue", items: [{ row: { kind: "continue" as const, entry }, index: 0 }], cursor: 0,
      onActivate: vi.fn(), onRemove: vi.fn(), onFocus: vi.fn(), canMerge: () => false, onMerge: vi.fn(), onMetadata: vi.fn() };
    await act(async () => { root.render(<LibrarySection {...props} metadataFor={() => ({ genres: [], sources: [{ sourceId: entry.animeId, provider: "aniwave", genres: [], availableEpisodes: 11, checkedAt: Date.now() }] })} />); });
    expect(container.querySelector(".badge.hi")?.textContent).toBe("EP 11/11");
    expect(container.querySelector(".card .s")?.textContent).toContain("Started 11");
    await act(async () => { root.render(<LibrarySection {...props} metadataFor={() => undefined} />); });
    expect(container.querySelector(".badge.hi")?.textContent).toBe("EP 11/?");
  });
});

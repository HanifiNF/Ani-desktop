// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScheduleSection from "../src/ScheduleSection";
import { DEFAULT_STATE } from "../shared/settings";
import type { AniDesktopApi, ScheduleEntry } from "../shared/contracts";

const makeEntry = (title: string, id: number, episode: string, releaseAt: string): ScheduleEntry => ({
  anime: { id: `aniwave:${title.toLowerCase()}-${id}`, title, provider: "aniwave", sources: [{ id: `aniwave:${title.toLowerCase()}-${id}`, title, aliases: [title], provider: "aniwave" }] },
  episode: { id: `aniwave:${id}:${episode}`, number: episode, provider: "aniwave" }, releaseAt, timeLabel: ""
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const scheduleResult = (date: string, title: string) => ({ provider: "aniwave" as const, requestedDate: date, supportedDates: ["2026-09-13", "2026-09-14"],
  refreshedAt: new Date().toISOString(), status: "fresh" as const, entries: [makeEntry(title, title === "Sunday" ? 1 : 2, "1", `${date}T12:00:00.000Z`)] });

describe("Home schedule section", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const open = vi.fn();
  const schedule = vi.fn<AniDesktopApi["schedule"]>();

  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 14, 18, 0));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    window.aniDesktop = { schedule, scheduleArtwork: vi.fn(async (animeId) => ({ animeId, aliases: [] })), cancelCatalog: vi.fn() } as unknown as AniDesktopApi;
    schedule.mockResolvedValue({ provider: "aniwave", requestedDate: "2026-09-14", supportedDates: ["2026-09-14"], refreshedAt: new Date().toISOString(), status: "fresh", entries: [
      makeEntry("Later", 2, "4", "2026-09-14T14:00:00.000Z"),
      makeEntry("Earlier", 1, "3", "2026-09-14T09:00:00.000Z")
    ] });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });

  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("selects Monday, labels the current season, sorts rows, dims elapsed releases, and opens without playing", async () => {
    await act(async () => { root.render(<ScheduleSection settings={DEFAULT_STATE.settings} library={[]} onOpen={open}
      metadataFor={() => ({ sources: [], genres: ["Fantasy", "Adventure"] })} onMetadata={() => undefined} />); });
    expect(container.querySelector("h2")?.textContent).toBe("Summer 2026 Season Schedule");
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(7);
    expect(tabs.find((tab) => tab.ariaSelected === "true")?.textContent).toContain("Mon");
    expect([...container.querySelectorAll(".schedule-title")].map((node) => node.textContent)).toEqual(["Earlier", "Later"]);
    expect(container.querySelector(".schedule-copy small")?.textContent).toBe("Fantasy · Adventure");
    expect(container.querySelectorAll(".schedule-row.past")).toHaveLength(1);
    await act(async () => { container.querySelector<HTMLButtonElement>(".schedule-row")!.click(); });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ title: "Earlier" }), expect.objectContaining({ number: "3" }), "sub");
  });

  it("ignores a superseded day response during rapid tab changes", async () => {
    const monday = deferred<ReturnType<typeof scheduleResult>>(), sunday = deferred<ReturnType<typeof scheduleResult>>();
    schedule.mockImplementation((query) => query.date === "2026-09-14" ? monday.promise : sunday.promise);
    await act(async () => { root.render(<ScheduleSection settings={DEFAULT_STATE.settings} library={[]} onOpen={open} />); });
    await act(async () => { container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0].click(); });
    await act(async () => { monday.resolve(scheduleResult("2026-09-14", "Monday")); await monday.promise; });
    expect(container.querySelector(".schedule-title")?.textContent).not.toBe("Monday");
    await act(async () => { sunday.resolve(scheduleResult("2026-09-13", "Sunday")); await sunday.promise; });
    expect(container.querySelector(".schedule-title")?.textContent).toBe("Sunday");
  });

  it("hides rows whose audio mode or source address does not match the active request", async () => {
    const dub = deferred<ReturnType<typeof scheduleResult>>();
    schedule.mockImplementation(async (query) => query.mode === "dub" ? dub.promise : scheduleResult(query.date, "Sub Show"));
    await act(async () => { root.render(<ScheduleSection settings={DEFAULT_STATE.settings} library={[]} onOpen={open} />); });
    expect(container.querySelector(".schedule-title")?.textContent).toBe("Sub Show");
    await act(async () => { [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "DUB")!.click(); });
    expect(container.querySelector(".schedule-title")).toBeNull();
    await act(async () => { dub.resolve(scheduleResult("2026-09-14", "Dub Show")); await dub.promise; });
    expect(container.querySelector(".schedule-title")?.textContent).toBe("Dub Show");

    const changed = { ...DEFAULT_STATE.settings, aniwaveBaseUrl: "https://alternate.test" };
    const alternate = deferred<ReturnType<typeof scheduleResult>>();
    schedule.mockReturnValueOnce(alternate.promise);
    await act(async () => { root.render(<ScheduleSection settings={changed} library={[]} onOpen={open} />); });
    expect(container.querySelector(".schedule-title")).toBeNull();
    await act(async () => { alternate.resolve(scheduleResult("2026-09-14", "Alternate")); await alternate.promise; });
    expect(container.querySelector(".schedule-title")?.textContent).toBe("Alternate");
  });
});


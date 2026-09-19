import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleService } from "../electron/schedule-service";
import { getAniwaveSchedule, getAniwaveScheduleArtwork } from "../electron/scraper";
import { chipsThatFit, localDateKey, msUntilNextLocalDay, releaseCountdown, releaseHasPassed, scheduleDays, seasonLabel, seasonScheduleTitle, selectionAfterDayChange, timezoneOffsetEast } from "../src/schedule";
import type { ScheduleQuery, ScheduleResult } from "../shared/contracts";
import { validateScheduleAnimeId, validateScheduleQuery } from "../electron/schedule-validation";

vi.mock("../electron/scraper", () => ({ getAniwaveSchedule: vi.fn(), getAniwaveScheduleArtwork: vi.fn() }));

const config = { preferredProvider: "auto" as const, aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app", hianimeBaseUrl: "https://hianimes.se" };
const query: ScheduleQuery = { date: "2026-09-14", timezoneOffset: 420, mode: "sub" };
const fresh: ScheduleResult = { provider: "aniwave", requestedDate: query.date, entries: [], refreshedAt: "2026-09-13T10:00:00.000Z", status: "fresh" };

beforeEach(() => vi.resetAllMocks());

describe("local schedule calendar", () => {
  it("maps every season boundary and year independently", () => {
    expect(seasonScheduleTitle(new Date(2026, 0, 1))).toBe("Winter 2026 Season Schedule");
    expect(seasonScheduleTitle(new Date(2026, 3, 1))).toBe("Spring 2026 Season Schedule");
    expect(seasonScheduleTitle(new Date(2026, 6, 1))).toBe("Summer 2026 Season Schedule");
    expect(seasonScheduleTitle(new Date(2026, 9, 1))).toBe("Fall 2026 Season Schedule");
    expect(seasonScheduleTitle(new Date(2027, 0, 1))).toBe("Winter 2027 Season Schedule");
  });

  it("builds a rolling strip from two days back, in date order, and marks today", () => {
    const monday = new Date(2026, 8, 14, 8);
    const days = scheduleDays(monday);
    expect(days.map((day) => day.date)).toEqual(["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]);
    expect(days.map((day) => day.dayOfMonth)).toEqual(["12", "13", "14", "15", "16", "17", "18"]);
    expect(days.findIndex((day) => day.today)).toBe(2);
    expect(new Set(days.map((day) => day.weekday)).size).toBe(7);
    expect(scheduleDays(new Date(2026, 9, 1, 8)).map((day) => day.date).slice(0, 3)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(localDateKey(monday)).toBe("2026-09-14");
    expect(timezoneOffsetEast(monday)).toBe(-monday.getTimezoneOffset());
  });

  it("moves the selection across a day change only when it was on today or fell off the strip", () => {
    const tuesday = new Date(2026, 8, 15, 0, 0, 1);
    expect(selectionAfterDayChange("2026-09-14", "2026-09-14", tuesday)).toBe("2026-09-15");
    expect(selectionAfterDayChange("2026-09-17", "2026-09-14", tuesday)).toBe("2026-09-17");
    expect(selectionAfterDayChange("2026-09-13", "2026-09-14", tuesday)).toBe("2026-09-13");
    expect(selectionAfterDayChange("2026-09-12", "2026-09-14", tuesday)).toBe("2026-09-15");
  });

  it("measures the time left in the local day", () => {
    expect(msUntilNextLocalDay(new Date(2026, 8, 14, 23, 59, 30))).toBe(30_000);
    expect(msUntilNextLocalDay(new Date(2026, 8, 30, 12))).toBe(12 * 60 * 60_000);
  });

  it("dims only after the complete release timestamp", () => {
    expect(releaseHasPassed("2026-09-14T10:00:00.000Z", new Date("2026-09-14T10:00:01.000Z"))).toBe(true);
    expect(releaseHasPassed("2026-09-14T10:00:00.000Z", new Date("2026-09-14T10:00:00.000Z"))).toBe(false);
  });
});

describe("schedule outage retention", () => {
  it("keeps the last normalized rows when a refresh fails", async () => {
    const service = new ScheduleService();
    vi.mocked(getAniwaveSchedule).mockResolvedValueOnce(fresh).mockRejectedValueOnce(new Error("provider offline"));
    expect(await service.get(query, config)).toEqual(fresh);
    expect(await service.get(query, config)).toEqual({ ...fresh, status: "stale", error: "provider offline" });
  });

  it("explains disabled AniWave and retains data loaded before it was disabled", async () => {
    const service = new ScheduleService();
    vi.mocked(getAniwaveSchedule).mockResolvedValue(fresh);
    await service.get(query, config);
    const disabled = await service.get(query, { ...config, disabledSources: ["aniwave"] });
    expect(disabled.status).toBe("stale");
    expect(disabled.error).toContain("Enable AniWave");
    const empty = await new ScheduleService().get(query, { ...config, disabledSources: ["aniwave"] });
    expect(empty).toMatchObject({ status: "unavailable", entries: [] });
  });

  it("reuses low-priority artwork metadata by provider address and anime ID", async () => {
    const service = new ScheduleService();
    vi.mocked(getAniwaveScheduleArtwork).mockResolvedValue({ animeId: "aniwave:show-42", aliases: ["Show"], poster: "https://img.test/show.jpg" });
    await service.getArtwork("aniwave:show-42", config);
    await service.getArtwork("aniwave:show-42", config);
    expect(getAniwaveScheduleArtwork).toHaveBeenCalledOnce();
  });
});

describe("schedule IPC validation", () => {
  it("accepts only real dates, bounded minute offsets, known modes, and AniWave IDs", () => {
    expect(validateScheduleQuery(query)).toEqual(query);
    for (const invalid of [null, { ...query, date: "2026-02-30" }, { ...query, date: "09/14/2026" }, { ...query, timezoneOffset: 841 }, { ...query, timezoneOffset: 1.5 }, { ...query, mode: "raw" }]) {
      expect(() => validateScheduleQuery(invalid)).toThrow("Invalid schedule request");
    }
    expect(validateScheduleAnimeId("aniwave:test-show-42")).toBe("aniwave:test-show-42");
    expect(() => validateScheduleAnimeId("hianime:test-show-42")).toThrow("Invalid schedule anime identifier");
    expect(() => validateScheduleAnimeId("aniwave:../../42")).toThrow("Invalid schedule anime identifier");
  });

  it("counts down to a release in hours and minutes, rounding minutes up, and goes quiet once it has passed", () => {
    const now = new Date("2026-09-14T10:00:00.000Z");
    expect(seasonLabel(new Date(2026, 6, 1))).toBe("Summer 2026");
    expect(releaseCountdown("2026-09-14T10:00:30.000Z", now)).toBe("in 1m");
    expect(releaseCountdown("2026-09-14T10:45:00.000Z", now)).toBe("in 45m");
    expect(releaseCountdown("2026-09-14T11:30:00.000Z", now)).toBe("in 1h 30m");
    expect(releaseCountdown("2026-09-14T16:00:00.000Z", now)).toBe("in 6h");
    expect(releaseCountdown("2026-09-15T00:20:00.000Z", now)).toBe("in 14h");
    expect(releaseCountdown("2026-09-17T10:00:00.000Z", now)).toBe("in 3 days");
    expect(releaseCountdown("2026-09-14T10:00:00.000Z", now)).toBe("");
    expect(releaseCountdown("not a date", now)).toBe("");
  });

  it("fits whole genre chips on one line and keeps room for a +n chip when some are left over", () => {
    expect(chipsThatFit(126, [60, 40], 4, 24)).toBe(2);           // both fit exactly at 104
    expect(chipsThatFit(140, [60, 40, 50], 4, 24)).toBe(2);       // third would need 158; two chips plus "+1" need 132
    expect(chipsThatFit(126, [60, 40, 50], 4, 24)).toBe(1);       // two chips would fit alone but leave no room for "+1"
    expect(chipsThatFit(126, [120], 4, 24)).toBe(1);              // a lone chip needs no "+n"
    expect(chipsThatFit(126, [130, 20], 4, 24)).toBe(0);          // nothing fits, only "+2"
    expect(chipsThatFit(0, [60, 60, 60], 4, 24)).toBe(3);         // unmeasured: show everything
    expect(chipsThatFit(126, [], 4, 24)).toBe(0);
  });
});

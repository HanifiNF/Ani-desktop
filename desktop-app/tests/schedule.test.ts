import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleService } from "../electron/schedule-service";
import { getAniwaveSchedule, getAniwaveScheduleArtwork } from "../electron/scraper";
import { localDateKey, localWeek, releaseHasPassed, seasonScheduleTitle, timezoneOffsetEast } from "../src/schedule";
import type { ScheduleQuery, ScheduleResult } from "../shared/contracts";
import { validateScheduleAnimeId, validateScheduleQuery } from "../electron/schedule-validation";

vi.mock("../electron/scraper", () => ({ getAniwaveSchedule: vi.fn(), getAniwaveScheduleArtwork: vi.fn() }));

const config = { preferredProvider: "auto" as const, aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app", hianimeBaseUrl: "https://hianimes.se" };
const query: ScheduleQuery = { date: "2026-09-14", timezoneOffset: 420, mode: "sub" };
const fresh: ScheduleResult = { provider: "aniwave", requestedDate: query.date, supportedDates: [query.date], entries: [], refreshedAt: "2026-09-13T10:00:00.000Z", status: "fresh" };

beforeEach(() => vi.resetAllMocks());

describe("local schedule calendar", () => {
  it("maps every season boundary and year independently", () => {
    expect(seasonScheduleTitle(new Date(2026, 0, 1))).toBe("Winter 2026 Season Schedule");
    expect(seasonScheduleTitle(new Date(2026, 3, 1))).toBe("Spring 2026 Season Schedule");
    expect(seasonScheduleTitle(new Date(2026, 6, 1))).toBe("Summer 2026 Season Schedule");
    expect(seasonScheduleTitle(new Date(2026, 9, 1))).toBe("Fall 2026 Season Schedule");
    expect(seasonScheduleTitle(new Date(2027, 0, 1))).toBe("Winter 2027 Season Schedule");
  });

  it("builds the Sunday-through-Saturday local week and marks today", () => {
    const monday = new Date(2026, 8, 14, 8);
    const week = localWeek(monday);
    expect(week.map((day) => day.date)).toEqual(["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]);
    expect(week.find((day) => day.today)?.date).toBe("2026-09-14");
    expect(localDateKey(monday)).toBe("2026-09-14");
    expect(timezoneOffsetEast(monday)).toBe(-monday.getTimezoneOffset());
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
});

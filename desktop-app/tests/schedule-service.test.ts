import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleService } from "../electron/schedule-service";
import { getAniwaveSchedule } from "../electron/scraper";

vi.mock("../electron/scraper", () => ({ getAniwaveSchedule: vi.fn(), getAniwaveScheduleArtwork: vi.fn() }));

const config = { preferredProvider: "auto" as const, aniwaveBaseUrl: "https://aniwave.test", anidbBaseUrl: "https://anidb.test", hianimeBaseUrl: "https://hianime.test" };
const query = { date: "2026-09-14", timezoneOffset: 420, mode: "sub" as const };
const result = { provider: "aniwave" as const, requestedDate: query.date, entries: [], refreshedAt: "2026-09-14T00:00:00.000Z", status: "fresh" as const };

beforeEach(() => vi.resetAllMocks());

describe("schedule stale fallback", () => {
  it("retains data only for the same date, mode, timezone, and source address", async () => {
    const service = new ScheduleService();
    vi.mocked(getAniwaveSchedule).mockResolvedValueOnce(result);
    await expect(service.get(query, config)).resolves.toEqual(result);
    vi.mocked(getAniwaveSchedule).mockRejectedValue(new Error("offline"));
    await expect(service.get(query, config)).resolves.toMatchObject({ requestedDate: query.date, status: "stale", error: "offline" });
    await expect(service.get({ ...query, mode: "dub" }, config)).rejects.toThrow("offline");
    await expect(service.get({ ...query, timezoneOffset: 480 }, config)).rejects.toThrow("offline");
    await expect(service.get({ ...query, date: "2026-09-13" }, config)).rejects.toThrow("offline");
    await expect(service.get(query, { ...config, aniwaveBaseUrl: "https://other.test" })).rejects.toThrow("offline");
  });
});

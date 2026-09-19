import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogContext } from "../electron/catalog-requests";
import { ScheduleService } from "../electron/schedule-service";
import { getAniwaveSchedule } from "../electron/scraper";
import type { ScheduleQuery } from "../shared/contracts";

const config = { preferredProvider: "auto" as const, aniwaveBaseUrl: "https://schedule.test", anidbBaseUrl: "https://anidb.test", hianimeBaseUrl: "https://hianime.test" };
const row = (id: number, title: string, time: string) => `<a class="item" href="/watch/show-${id}/ep-12"><div class="time" data-tip="${id}">${time}</div><div class="title d-title">${title}</div></a>`;
const fixedDay = (date: string, offset: number, mode: "sub" | "dub" = "sub"): ScheduleQuery => {
  const start = Date.parse(`${date}T00:00:00Z`) - offset * 60_000;
  return { date, utcStart: new Date(start).toISOString(), utcEnd: new Date(start + 86_400_000).toISOString(), mode };
};
function mockPages(pages: Record<string, string>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("tz")).toBe("0");
    return new Response(JSON.stringify({ result: pages[url.searchParams.get("time")!] ?? "" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("UTC schedule assembly", () => {
  it("keeps Sunday evening releases in GMT+7 and restores them on Monday in GMT+10", async () => {
    mockPages({ "2026-09-20": row(1, "Sparks of Tomorrow", "02:00 PM") + row(2, "Mushoku Tensei", "03:00 PM") + row(3, "Goodbye, Lara", "03:30 PM") });
    const friend = await getAniwaveSchedule(fixedDay("2026-09-20", 420), config);
    const sunday = await getAniwaveSchedule(fixedDay("2026-09-20", 600), config);
    const monday = await getAniwaveSchedule(fixedDay("2026-09-21", 600), config);
    expect(friend.entries.map((entry) => entry.anime.title)).toEqual(["Sparks of Tomorrow", "Mushoku Tensei", "Goodbye, Lara"]);
    expect(sunday.entries).toEqual([]);
    expect(monday.entries).toEqual(friend.entries);
    expect(monday.entries.map((entry) => entry.releaseAt)).toEqual(["2026-09-20T14:00:00.000Z", "2026-09-20T15:00:00.000Z", "2026-09-20T15:30:00.000Z"]);
  });

  it.each([600, -300, 345, -210, 0, 840, -720])("includes midnight and excludes the next midnight at offset %i, across a year boundary", async (offset) => {
    const query = fixedDay("2027-01-01", offset);
    const timestamps = [Date.parse(query.utcStart) - 60_000, Date.parse(query.utcStart), Date.parse(query.utcEnd) - 60_000, Date.parse(query.utcEnd)];
    const pages: Record<string, string> = {};
    timestamps.forEach((timestamp, index) => {
      const date = new Date(timestamp);
      const key = date.toISOString().slice(0, 10);
      const time = `${String(date.getUTCHours() % 12 || 12).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} ${date.getUTCHours() >= 12 ? "PM" : "AM"}`;
      pages[key] = (pages[key] ?? "") + row(index + 1, `Show ${index}`, time);
    });
    const fetchMock = mockPages(pages);
    const value = await getAniwaveSchedule(query, config);
    expect(value.entries.map((entry) => entry.releaseAt)).toEqual(timestamps.slice(1, 3).map((time) => new Date(time).toISOString()));
    expect(fetchMock).toHaveBeenCalledTimes(offset === 0 ? 1 : 2);
    expect(fetchMock.mock.calls.every(([input]) => !new URL(String(input)).searchParams.has("dub"))).toBe(true);
  });

  it("sorts and deduplicates rows from overlapping UTC dates", async () => {
    const first = row(1, "First", "02:00 PM");
    mockPages({ "2026-09-20": row(2, "Second", "03:00 PM") + first + first, "2026-09-21": row(3, "Third", "01:00 AM") });
    const value = await getAniwaveSchedule(fixedDay("2026-09-21", 600), config);
    expect(value.entries.map((entry) => entry.anime.title)).toEqual(["First", "Second", "Third"]);
  });

  it.each([
    ["2026-10-04", "2026-10-03T14:00:00.000Z", "2026-10-04T13:00:00.000Z", "12:59 PM", "01:00 PM"],
    ["2026-04-05", "2026-04-04T13:00:00.000Z", "2026-04-05T14:00:00.000Z", "01:59 PM", "02:00 PM"]
  ])("respects the end of a daylight-saving transition day on %s", async (date, utcStart, utcEnd, inside, outside) => {
    mockPages({ [date]: row(1, "Last minute", inside) + row(2, "Next day", outside) });
    const value = await getAniwaveSchedule({ date, utcStart, utcEnd, mode: "sub" }, config);
    expect(value.entries.map((entry) => entry.anime.title)).toEqual(["Last minute"]);
  });

  it("reuses UTC responses across neighboring tabs and keeps SUB/DUB caches separate", async () => {
    const fetchMock = mockPages({});
    await catalogContext.run({ signal: new AbortController().signal, scope: "schedule-utc-cache", priority: 2 }, async () => {
      await getAniwaveSchedule(fixedDay("2026-09-20", 600), config);
      await getAniwaveSchedule(fixedDay("2026-09-21", 600), config);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await getAniwaveSchedule(fixedDay("2026-09-21", 420), config);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await getAniwaveSchedule(fixedDay("2026-09-21", 600, "dub"), config);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(fetchMock.mock.calls.slice(3).every(([input]) => new URL(String(input)).searchParams.get("dub") === "1")).toBe(true);
    });
  });

  it("preserves the complete saved schedule when either UTC date fails", async () => {
    const fetchMock = mockPages({ "2026-09-20": row(1, "Overnight", "02:00 PM"), "2026-09-21": row(2, "Afternoon", "05:00 AM") });
    const query = fixedDay("2026-09-21", 600);
    const service = new ScheduleService();
    const fresh = await service.get(query, config);
    expect(fresh.entries).toHaveLength(2);
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).searchParams.get("time") === "2026-09-20") throw new Error("offline");
      return new Response(JSON.stringify({ result: row(2, "Afternoon", "05:00 AM") }));
    });
    await expect(service.get(query, config)).resolves.toEqual({ ...fresh, status: "stale", error: "offline" });
    await expect(new ScheduleService().get(query, config)).rejects.toThrow("offline");
  });
});

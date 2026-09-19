import type { ScheduleQuery } from "../shared/contracts";

export function validateScheduleQuery(value: unknown): ScheduleQuery {
  if (!value || typeof value !== "object") throw new Error("Invalid schedule request");
  const query = value as Partial<ScheduleQuery>;
  const midnight = Date.parse(`${query.date}T00:00:00Z`);
  const start = typeof query.utcStart === "string" ? Date.parse(query.utcStart) : NaN;
  const end = typeof query.utcEnd === "string" ? Date.parse(query.utcEnd) : NaN;
  const hour = 60 * 60_000, day = 24 * hour;
  if (typeof query.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(query.date)
    || !Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== query.date
    || !Number.isFinite(start) || !Number.isFinite(end)
    || new Date(start).toISOString() !== query.utcStart || new Date(end).toISOString() !== query.utcEnd
    || Math.abs(start - midnight) > 14 * hour || Math.abs(end - midnight - day) > 14 * hour
    || end <= start || end - start > 27 * hour
    || !["sub", "dub"].includes(query.mode ?? "")) throw new Error("Invalid schedule request");
  return query as ScheduleQuery;
}

export function validateScheduleAnimeId(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !/^aniwave:[a-z0-9-]+-\d+$/i.test(value)) throw new Error("Invalid schedule anime identifier");
  return value;
}

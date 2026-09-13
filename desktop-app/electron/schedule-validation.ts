import type { ScheduleQuery } from "../shared/contracts";

export function validateScheduleQuery(value: unknown): ScheduleQuery {
  if (!value || typeof value !== "object") throw new Error("Invalid schedule request");
  const query = value as Partial<ScheduleQuery>;
  if (typeof query.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(query.date)
    || new Date(`${query.date}T00:00:00Z`).toISOString().slice(0, 10) !== query.date
    || !Number.isInteger(query.timezoneOffset) || query.timezoneOffset! < -14 * 60 || query.timezoneOffset! > 14 * 60
    || !["sub", "dub"].includes(query.mode ?? "")) throw new Error("Invalid schedule request");
  return query as ScheduleQuery;
}

export function validateScheduleAnimeId(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !/^aniwave:[a-z0-9-]+-\d+$/i.test(value)) throw new Error("Invalid schedule anime identifier");
  return value;
}


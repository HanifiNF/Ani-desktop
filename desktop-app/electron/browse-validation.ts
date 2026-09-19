import type { BrowseFilters, BrowseQuery, BrowseSort, IdentityCandidate, MediaType, WorkStatus } from "../shared/contracts";
import { isRef, mediaTypeOf, positiveInteger, unique, yearOf } from "../shared/identity";

const sorts: BrowseSort[] = ["popularity", "score", "newest", "title"];
const seasons = ["winter", "spring", "summer", "fall"] as const;
const statuses: Exclude<WorkStatus, "unknown">[] = ["finished", "ongoing", "upcoming"];
const formats: MediaType[] = ["TV", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"];
const integer = (value: unknown, min: number, max: number): number | undefined => value === undefined ? undefined
  : typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : (() => { throw new Error("Invalid browse filter"); })();
const genres = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Invalid browse genres");
  const normalized = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (normalized.some((item) => !item || item.length > 60)) throw new Error("Invalid browse genres");
  return normalized.filter((item, index) => normalized.findIndex((other) => other.toLocaleLowerCase() === item.toLocaleLowerCase()) === index);
};

export function validateBrowseQuery(value: unknown): BrowseQuery {
  if (!value || typeof value !== "object") throw new Error("Invalid browse request");
  const raw = value as { page?: unknown; filters?: Record<string, unknown> };
  if (!raw.filters || typeof raw.filters !== "object") throw new Error("Invalid browse filters");
  const includeGenres = genres(raw.filters.includeGenres), excludeGenres = genres(raw.filters.excludeGenres);
  if (includeGenres.some((genre) => excludeGenres.some((item) => item.toLocaleLowerCase() === genre.toLocaleLowerCase()))) throw new Error("A genre cannot be included and excluded");
  const sort = raw.filters.sort;
  if (typeof sort !== "string" || !sorts.includes(sort as BrowseSort)) throw new Error("Invalid browse sort");
  const season = raw.filters.season, status = raw.filters.status, format = raw.filters.format;
  if (season !== undefined && !seasons.includes(season as typeof seasons[number])) throw new Error("Invalid browse season");
  if (status !== undefined && !statuses.includes(status as typeof statuses[number])) throw new Error("Invalid browse status");
  if (format !== undefined && !formats.includes(format as MediaType)) throw new Error("Invalid browse format");
  const minimumEpisodes = integer(raw.filters.minimumEpisodes, 1, 100_000), maximumEpisodes = integer(raw.filters.maximumEpisodes, 1, 100_000);
  if (minimumEpisodes !== undefined && maximumEpisodes !== undefined && minimumEpisodes > maximumEpisodes) throw new Error("Invalid episode range");
  const filters: BrowseFilters = { includeGenres, excludeGenres, sort: sort as BrowseSort,
    year: integer(raw.filters.year, 1900, 2200), minimumScore: integer(raw.filters.minimumScore, 1, 100), minimumEpisodes, maximumEpisodes,
    ...(season === undefined ? {} : { season: season as BrowseFilters["season"] }),
    ...(status === undefined ? {} : { status: status as BrowseFilters["status"] }),
    ...(format === undefined ? {} : { format: format as MediaType }) };
  return { page: integer(raw.page, 1, 10_000) ?? 1, filters };
}

/** A work the renderer already identified, offered to search as a grouping candidate. Absent when nothing was sent. */
export function validateKnownCandidate(value: unknown): IdentityCandidate | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error("Invalid known work");
  const raw = value as Record<string, unknown>;
  const titles = Array.isArray(raw.titles) ? raw.titles : [];
  if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 500 || !Array.isArray(raw.refs) || raw.refs.length > 8 || !raw.refs.every(isRef)
    || !raw.refs.length || titles.length > 100 || !titles.every((title) => typeof title === "string" && title.length <= 500)) throw new Error("Invalid known work");
  const type = mediaTypeOf(raw.type), year = yearOf(raw.year), episodes = positiveInteger(raw.episodes);
  const status = statuses.find((item) => item === raw.status);
  return { refs: unique(raw.refs as string[]), title: raw.title.trim(), titles: unique([raw.title, ...titles as string[]].map((title) => title.trim()).filter(Boolean)),
    ...(type ? { type } : {}), ...(year ? { year } : {}), ...(episodes ? { episodes } : {}), ...(status ? { status } : {}) };
}

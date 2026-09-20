import type { BrowseFilters, BrowseIdentity, BrowseQuery, BrowseSort, BrowseStudio, IdentityCandidate, MediaType, WorkStatus } from "../shared/contracts";
import { conflictingRefs, isRef, mediaTypeOf, positiveInteger, unique, yearOf } from "../shared/identity";

const sorts: BrowseSort[] = ["match", "popularity", "score", "newest", "title"];
const seasons = ["winter", "spring", "summer", "fall"] as const;
const statuses: Exclude<WorkStatus, "unknown">[] = ["finished", "ongoing", "upcoming"];
const formats: MediaType[] = ["TV", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"];
const integer = (value: unknown, min: number, max: number): number | undefined => value === undefined ? undefined
  : typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : (() => { throw new Error("Invalid browse filter"); })();
const genres = (value: unknown, label = "genres"): string[] => {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`Invalid browse ${label}`);
  const normalized = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (normalized.some((item) => !item || item.length > 60)) throw new Error(`Invalid browse ${label}`);
  return normalized.filter((item, index) => normalized.findIndex((other) => other.toLocaleLowerCase() === item.toLocaleLowerCase()) === index);
};

/** A search term worth sending: trimmed, at least two characters, no longer than the search field allows. */
function validateBrowseTerm(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 120) throw new Error("Invalid browse search");
  const term = value.trim().replace(/\s+/g, " ");
  return term.length >= 2 ? term : undefined;
}
const studioOf = (value: unknown): BrowseStudio | undefined => {
  if (value === undefined) return undefined;
  const raw = value as Partial<BrowseStudio> | null;
  if (!raw || typeof raw !== "object" || !positiveInteger(raw.id) || typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 120) throw new Error("Invalid browse studio");
  return { id: raw.id!, name: raw.name.trim(), animation: raw.animation === true };
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
  const search = validateBrowseTerm(raw.filters.search), studio = studioOf(raw.filters.studio);
  const tags = raw.filters.tags === undefined ? [] : genres(raw.filters.tags, "tags");
  // Closeness only means something against a term.
  const filters: BrowseFilters = { includeGenres, excludeGenres, sort: sort === "match" && !search ? "popularity" : sort as BrowseSort,
    ...(search ? { search } : {}), ...(tags.length ? { tags } : {}), ...(studio ? { studio } : {}),
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

export function validateBrowseIdentity(value: unknown): BrowseIdentity {
  const known = validateKnownCandidate(value);
  if (!known || conflictingRefs(known.refs, known.refs)) throw new Error("Invalid browse identity");
  const raw = (value as Record<string, unknown>).titleVariants;
  if (raw === undefined) return known; // Older browse caches contain the flattened titles only.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid browse titles");
  const titleVariants: NonNullable<BrowseIdentity["titleVariants"]> = {};
  for (const key of ["english", "romaji", "native"] as const) {
    const title = (raw as Record<string, unknown>)[key];
    if (title === undefined) continue;
    if (typeof title !== "string" || title.length > 500) throw new Error("Invalid browse titles");
    if (title.trim()) titleVariants[key] = title.trim();
  }
  return { ...known, titles: unique([...known.titles, ...Object.values(titleVariants)]), titleVariants };
}

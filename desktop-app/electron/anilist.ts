import type { BrowseAnime, BrowseQuery, BrowseStudio, IdentityCandidate, MediaType, WorkInfo, WorkRelation, WorkStatus } from "../shared/contracts";
import { isRef, mediaTypeOf, positiveInteger, ref, unique } from "../shared/identity";
import { catalogContext, catalogRequests, CatalogNetworkError } from "./catalog-requests";
import { retryAfterDelay } from "./scraper";

/*
 * AniList is one witness for identity and series information, never the authority: the app's own works are.
 * It needs no key, answers by MyAnimeList id as well as its own, and states a rate limit in response headers,
 * which this client honours by pausing before the limit is reached.
 */

export const ANILIST_ORIGIN = "https://graphql.anilist.co";
const DAY = 24 * 60 * 60_000;
const USER_AGENT = "ANIdesktop (https://github.com/HanifiNF/Ani-cli-aniwave)";

const MEDIA_FIELDS = `id idMal title { romaji english native } synonyms format episodes seasonYear season startDate { year } status`;
const INFO_FIELDS = `${MEDIA_FIELDS} genres studios(isMain: true) { nodes { name } } averageScore description(asHtml: false)
  tags { name isAdult isGeneralSpoiler isMediaSpoiler }
  coverImage { extraLarge large } bannerImage nextAiringEpisode { episode airingAt }
  relations { edges { relationType node { id idMal type title { romaji english } format } } }`;

let pausedUntil = 0;
/** For tests: forget a remembered rate-limit pause. */
export const resetAniListRateLimit = () => { pausedUntil = 0; };

async function gate(signal: AbortSignal): Promise<void> {
  const wait = pausedUntil - Date.now();
  if (wait <= 0) return;
  if (wait > 90_000) throw new CatalogNetworkError("AniList rate limit reached", wait);
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, wait);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function graphql(query: string, variables: Record<string, unknown>, label: string, ttl: number): Promise<unknown> {
  const body = JSON.stringify({ query, variables });
  const execute = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    await gate(signal);
    let response: Response;
    try {
      response = await fetch(ANILIST_ORIGIN, {
        method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT }
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new CatalogNetworkError(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const remainingHeader = response.headers.get("x-ratelimit-remaining");
    const resetHeader = response.headers.get("x-ratelimit-reset");
    const remaining = remainingHeader === null ? NaN : Number(remainingHeader);
    const reset = resetHeader === null ? NaN : Number(resetHeader);
    // Leave a small margin so playback-adjacent requests never hit the limit head-on.
    if (Number.isFinite(remaining) && remaining <= 2) pausedUntil = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 60_000;
    if (response.status === 429) {
      const retry = retryAfterDelay(response.headers.get("retry-after")) || 60_000;
      pausedUntil = Math.max(pausedUntil, Date.now() + retry);
      await response.body?.cancel();
      throw new CatalogNetworkError(`${label} failed (429)`, retry);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 500) throw new CatalogNetworkError(`${label} failed (${response.status})`);
      throw new Error(`${label} failed (${response.status})`);
    }
    return response.text();
  };
  const context = catalogContext.getStore();
  const text = context ? await catalogRequests.read(JSON.stringify(["anilist", body]), ANILIST_ORIGIN, ttl, execute, context) : await execute(new AbortController().signal);
  const parsed = JSON.parse(text) as { data?: unknown; errors?: { message?: string; status?: number }[] };
  if (parsed.errors?.length && !parsed.data) {
    if (parsed.errors.some((error) => error.status === 404)) return undefined;
    throw new Error(`${label}: ${parsed.errors.map((error) => error.message).filter(Boolean).join("; ") || "unknown error"}`);
  }
  return parsed.data;
}

type Media = Record<string, unknown>;
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const titlesOf = (media: Media) => {
  const title = (media.title && typeof media.title === "object" ? media.title : {}) as Record<string, unknown>;
  return { romaji: text(title.romaji), english: text(title.english), native: text(title.native) };
};
const refsOfMedia = (media: Media): string[] => unique([
  ...(positiveInteger(media.id) ? [ref("anilist", positiveInteger(media.id)!)] : []),
  ...(positiveInteger(media.idMal) ? [ref("mal", positiveInteger(media.idMal)!)] : [])
]);
const statusOf = (value: unknown): WorkStatus => value === "FINISHED" ? "finished" : value === "RELEASING" ? "ongoing" : value === "NOT_YET_RELEASED" ? "upcoming" : "unknown";
const formatOf = (value: unknown): MediaType | undefined => mediaTypeOf(typeof value === "string" ? value.replace("TV_SHORT", "TV").replace("MUSIC", "music") : value);
const yearOfMedia = (media: Media): number | undefined => positiveInteger(media.seasonYear) ?? positiveInteger((media.startDate as Record<string, unknown> | undefined)?.year);

export function toCandidate(media: Media): IdentityCandidate | undefined {
  const refs = refsOfMedia(media);
  const titles = titlesOf(media);
  const synonyms = Array.isArray(media.synonyms) ? media.synonyms.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
  const all = unique([titles.romaji, titles.english, titles.native, ...synonyms].filter((value): value is string => Boolean(value)));
  if (!refs.length || !all.length) return undefined;
  const type = formatOf(media.format), year = yearOfMedia(media), episodes = positiveInteger(media.episodes);
  return { refs, title: titles.english ?? titles.romaji ?? all[0], titles: all, status: statusOf(media.status), ...(type ? { type } : {}), ...(year ? { year } : {}), ...(episodes ? { episodes } : {}) };
}

/** AniList descriptions carry light HTML; the series screen shows plain text. */
export function plainDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const plain = value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n").trim();
  return plain || undefined;
}

export function toWorkInfo(media: Media): WorkInfo | undefined {
  const candidate = toCandidate(media);
  if (!candidate) return undefined;
  const studios = ((media.studios as Record<string, unknown> | undefined)?.nodes as Record<string, unknown>[] | undefined ?? [])
    .map((node) => text(node?.name)).filter((value): value is string => Boolean(value));
  const cover = media.coverImage as Record<string, unknown> | undefined;
  const airing = media.nextAiringEpisode as Record<string, unknown> | undefined;
  const nextAiring = airing && positiveInteger(airing.episode) && positiveInteger(airing.airingAt) ? { episode: positiveInteger(airing.episode)!, airingAt: positiveInteger(airing.airingAt)! * 1000 } : undefined;
  const edges = ((media.relations as Record<string, unknown> | undefined)?.edges as Record<string, unknown>[] | undefined) ?? [];
  const relations: WorkRelation[] = edges.flatMap((edge) => {
    const node = edge?.node as Media | undefined;
    if (!node || node.type !== "ANIME") return [];
    const refs = refsOfMedia(node), titles = titlesOf(node), title = titles.english ?? titles.romaji;
    if (!refs.length || !title) return [];
    const type = formatOf(node.format);
    return [{ relation: String(edge.relationType ?? "RELATED").toLowerCase().replace(/_/g, " "), refs, title, ...(type ? { type } : {}) }];
  });
  const score = positiveInteger(media.averageScore);
  return {
    refs: candidate.refs, title: candidate.title, titles: titlesOf(media), synonyms: candidate.titles.filter((title) => !Object.values(titlesOf(media)).includes(title)),
    type: candidate.type, episodes: candidate.episodes, year: candidate.year, season: text(media.season)?.toLowerCase(), status: candidate.status ?? "unknown",
    genres: Array.isArray(media.genres) ? media.genres.filter((value): value is string => typeof value === "string") : [], studios,
    tags: unique((Array.isArray(media.tags) ? media.tags as Record<string, unknown>[] : [])
      .filter((tag) => tag && tag.isAdult !== true && tag.isGeneralSpoiler !== true && tag.isMediaSpoiler !== true)
      .map((tag) => text(tag.name)).filter((value): value is string => Boolean(value))),
    ...(score ? { score } : {}), description: plainDescription(media.description),
    cover: text(cover?.extraLarge) ?? text(cover?.large), banner: text(media.bannerImage), ...(nextAiring ? { nextAiring } : {}),
    relations, fetchedAt: Date.now(), source: "anilist"
  };
}

/** Works AniList names for a search term. Cached for a day by the shared request cache. */
export async function searchAniList(term: string): Promise<IdentityCandidate[]> {
  const query = `query ($search: String) { Page(perPage: 25) { media(search: $search, type: ANIME) { ${MEDIA_FIELDS} } } }`;
  const data = await graphql(query, { search: term }, "AniList search", DAY) as { Page?: { media?: Media[] } } | undefined;
  return (data?.Page?.media ?? []).map(toCandidate).filter((candidate): candidate is IdentityCandidate => Boolean(candidate));
}

// Cards and the catalog detail need far less than the series screen, which looks the work up itself once it opens.
const BROWSE_FIELDS = `${MEDIA_FIELDS} genres averageScore description(asHtml: false) coverImage { extraLarge large }`;
const browseSort = { match: "SEARCH_MATCH", popularity: "POPULARITY_DESC", score: "SCORE_DESC", newest: "START_DATE_DESC", title: "TITLE_ENGLISH" } as const;
/** AniList's FuzzyDateInt: a date as the number YYYYMMDD. */
const fuzzyDate = (date: Date): number => date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();
const browseStatus = { finished: "FINISHED", ongoing: "RELEASING", upcoming: "NOT_YET_RELEASED" } as const;

/** The stable genre vocabulary used by the browse filter. Browse never lists adult titles, so the adult-only genre would always be empty. */
export async function aniListGenres(): Promise<string[]> {
  const data = await graphql("query { GenreCollection }", {}, "AniList genres", 7 * DAY) as { GenreCollection?: unknown } | undefined;
  return Array.isArray(data?.GenreCollection)
    ? data.GenreCollection.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
      .filter((value) => value.toLowerCase() !== "hentai").sort()
    : [];
}

/** The non-adult tag vocabulary ("Isekai", "Time Travel"), finer than genres. */
export async function aniListTags(): Promise<string[]> {
  const data = await graphql("query { MediaTagCollection { name isAdult } }", {}, "AniList tags", 7 * DAY) as { MediaTagCollection?: { name?: unknown; isAdult?: unknown }[] } | undefined;
  return unique((data?.MediaTagCollection ?? []).filter((tag) => tag?.isAdult !== true).map((tag) => text(tag?.name)).filter((value): value is string => Boolean(value))).sort((a, b) => a.localeCompare(b));
}

const STUDIO_FIELDS = "id name isAnimationStudio";
// Companies that animate lead; AniList's own order holds within each group.
const toStudios = (nodes: unknown): BrowseStudio[] => (Array.isArray(nodes) ? nodes as Record<string, unknown>[] : []).flatMap((node) => {
  const id = positiveInteger(node?.id), name = text(node?.name);
  return id && name ? [{ id, name, animation: node.isAnimationStudio === true }] : [];
}).sort((a, b) => Number(b.animation) - Number(a.animation));

function toBrowseAnime(media: Media): BrowseAnime[] {
  const info = toWorkInfo(media);
  const id = positiveInteger(media.id);
  if (!info || !id) return [];
  return [{ anilistId: id, refs: info.refs, title: info.title, titleVariants: info.titles, titles: unique([info.title, ...Object.values(info.titles), ...info.synonyms].filter((value): value is string => Boolean(value))),
    cover: info.cover, genres: info.genres, type: info.type, year: info.year, season: info.season, status: info.status,
    score: info.score, episodes: info.episodes, description: info.description, studios: info.studios }];
}

/**
 * One page of a studio's works, most popular first. A studio's list takes no filters, so browse reads it as ids
 * and hands them to the ordinary catalog query. The first page also carries card details, to show while the rest is read.
 */
export async function aniListStudioPage(studio: BrowseStudio, page: number): Promise<{ ids: number[]; entries: BrowseAnime[]; hasNextPage: boolean }> {
  const fields = page === 1 ? BROWSE_FIELDS : "id";
  // A producer is never the main studio of what it funds.
  const document = `query ($id: Int, $page: Int, $main: Boolean) { Studio(id: $id) { media(isMain: $main, page: $page, perPage: 25, sort: POPULARITY_DESC) { pageInfo { hasNextPage } nodes { type isAdult ${fields} } } } }`;
  const data = await graphql(document, { id: studio.id, page, main: studio.animation ? true : undefined }, "AniList studio", 7 * DAY) as { Studio?: { media?: { pageInfo?: { hasNextPage?: unknown }; nodes?: Media[] } } } | undefined;
  const nodes = (data?.Studio?.media?.nodes ?? []).filter((node) => node?.type === "ANIME" && node.isAdult !== true);
  return { ids: nodes.map((node) => positiveInteger(node.id)).filter((id): id is number => Boolean(id)), entries: page === 1 ? nodes.flatMap(toBrowseAnime) : [], hasNextPage: data?.Studio?.media?.pageInfo?.hasNextPage === true };
}

/** `ids` narrows the catalog to a studio's works; an empty list means the studio has none. */
export async function browseAniList(query: BrowseQuery, ids?: number[]): Promise<{ entries: BrowseAnime[]; hasNextPage: boolean; studios?: BrowseStudio[] }> {
  const { filters, page } = query;
  if (ids && !ids.length) return { entries: [], hasNextPage: false };
  // The first page of a title search asks for matching studios in the same request.
  const withStudios = Boolean(filters.search) && !filters.studio && page === 1;
  const document = `query ($page: Int, $genres: [String], $excluded: [String], $year: Int, $season: MediaSeason, $search: String, $tags: [String], $ids: [Int],
    $status: MediaStatus, $startedAfter: FuzzyDateInt, $startedBefore: FuzzyDateInt, $format: MediaFormat, $score: Int, $minEpisodes: Int, $maxEpisodes: Int, $sort: [MediaSort]) {
    Page(page: $page, perPage: 24) {
      pageInfo { hasNextPage }
      media(type: ANIME, isAdult: false, search: $search, tag_in: $tags, id_in: $ids, genre_in: $genres, genre_not_in: $excluded, seasonYear: $year,
        season: $season, status: $status, startDate_greater: $startedAfter, startDate_lesser: $startedBefore, format: $format, averageScore_greater: $score,
        episodes_greater: $minEpisodes, episodes_lesser: $maxEpisodes, sort: $sort) { ${BROWSE_FIELDS} }
    }${withStudios ? `
    matching: Page(perPage: 6) { studios(search: $search, sort: SEARCH_MATCH) { ${STUDIO_FIELDS} } }` : ""}
  }`;
  const variables = {
    page,
    search: filters.search,
    tags: filters.tags?.length ? filters.tags : undefined,
    ids,
    genres: filters.includeGenres.length ? filters.includeGenres : undefined,
    excluded: filters.excludeGenres.length ? filters.excludeGenres : undefined,
    year: filters.year,
    season: filters.season?.toUpperCase(),
    status: filters.status ? browseStatus[filters.status] : undefined,
    // AniList sorts undated entries first, which would bury every released title under unannounced and cancelled ones.
    startedAfter: filters.sort === "newest" ? 10_000_000 : undefined,
    // Without a chosen status, "newest" means released; a day of slack covers time zones ahead of this one.
    startedBefore: filters.sort === "newest" && !filters.status ? fuzzyDate(new Date(Date.now() + DAY)) : undefined,
    format: filters.format,
    score: filters.minimumScore === undefined ? undefined : Math.max(0, filters.minimumScore - 1),
    minEpisodes: filters.minimumEpisodes === undefined ? undefined : Math.max(0, filters.minimumEpisodes - 1),
    maxEpisodes: filters.maximumEpisodes === undefined ? undefined : filters.maximumEpisodes + 1,
    sort: [browseSort[filters.sort === "match" && !filters.search ? "popularity" : filters.sort]]
  };
  const data = await graphql(document, variables, "AniList browse", 30 * 60_000) as { Page?: { pageInfo?: { hasNextPage?: unknown }; media?: Media[] }; matching?: { studios?: unknown } } | undefined;
  const entries = (data?.Page?.media ?? []).flatMap(toBrowseAnime)
    .filter((entry) => filters.includeGenres.every((genre) => entry.genres.some((value) => value.toLocaleLowerCase() === genre.toLocaleLowerCase())))
    .filter((entry) => !filters.excludeGenres.some((genre) => entry.genres.some((value) => value.toLocaleLowerCase() === genre.toLocaleLowerCase())))
    .filter((entry) => filters.minimumEpisodes === undefined || (entry.episodes !== undefined && entry.episodes >= filters.minimumEpisodes))
    .filter((entry) => filters.maximumEpisodes === undefined || (entry.episodes !== undefined && entry.episodes <= filters.maximumEpisodes));
  return { entries, hasNextPage: data?.Page?.pageInfo?.hasNextPage === true, ...(withStudios ? { studios: toStudios(data?.matching?.studios) } : {}) };
}

/** Full information for one work, by its AniList id or, failing that, its MyAnimeList id. */
export async function lookupAniList(refs: string[]): Promise<WorkInfo | undefined> {
  const anilist = refs.find((value) => isRef(value) && value.startsWith("anilist:"));
  const mal = refs.find((value) => isRef(value) && value.startsWith("mal:"));
  if (!anilist && !mal) return undefined;
  const query = anilist
    ? `query ($id: Int) { Media(id: $id, type: ANIME) { ${INFO_FIELDS} } }`
    : `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { ${INFO_FIELDS} } }`;
  const variables = anilist ? { id: Number(anilist.slice(8)) } : { idMal: Number(mal!.slice(4)) };
  const data = await graphql(query, variables, "AniList lookup", 60_000) as { Media?: Media | null } | undefined;
  return data?.Media ? toWorkInfo(data.Media) : undefined;
}

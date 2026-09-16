import type { IdentityCandidate, MediaType, WorkInfo, WorkRelation, WorkStatus } from "../shared/contracts";
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
    const remaining = Number(response.headers.get("x-ratelimit-remaining"));
    const reset = Number(response.headers.get("x-ratelimit-reset"));
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

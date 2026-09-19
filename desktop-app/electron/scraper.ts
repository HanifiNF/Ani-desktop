import { catalogContext, catalogRequests, CatalogNetworkError } from "./catalog-requests";
import type { AnimeResult, Episode, EpisodeAvailability, ProviderName, ProviderSeriesMetadata, ScheduleArtwork, ScheduleQuery, ScheduleResult, Settings, Stream, TranslationMode } from "../shared/contracts";
import { animeSources, isProviderName, sourceMatch } from "../shared/catalog";
import { positiveInteger } from "../shared/identity";
import { collectEpisodePages, MAX_EPISODES } from "./episode-loader";
import { findEmbedUrl, hiAnimeEmbedUrls, parseAniDbSeriesMetadata, parseAniwaveEpisodes, parseAniwavePoster, parseAniwaveSchedule, parseAniwaveSearch, parseAniwaveSeriesMetadata, parseAniwaveTooltip, parseAniwaveVidplayId, parseEpisodes, parseHiAnimeEmbed, parseHiAnimeEpisodes, parseHiAnimeSearch, parseHiAnimeSeriesMetadata, parseMasterPlaylist, parseMasterUrl, parseResultUrl, parseSearchPage, parseVidplaySource } from "./parsers";

const RETRY_DELAY_MS = 750;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export type SourceConfig = Pick<Settings, "preferredProvider" | "aniwaveBaseUrl" | "anidbBaseUrl" | "hianimeBaseUrl" | "disabledSources">;
const HIANIME_API_BASE = "https://animehot.cc/api";
export function providerOrigin(provider: ProviderName, config: SourceConfig): string {
  return new URL(provider === "hianime" ? HIANIME_API_BASE : provider === "aniwave" ? config.aniwaveBaseUrl : config.anidbBaseUrl).origin;
}

function sourceBase(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Source URLs must use HTTP or HTTPS");
  return url.toString().replace(/\/$/, "");
}
function absolute(value: string, relativeTo: string): string {
  const url = new URL(value, relativeTo);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported source URL");
  return url.toString();
}
export function retryAfterDelay(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 0;
  const clean = value.trim();
  const delay = /^\d+$/.test(clean) ? Number(clean) * 1000 : Date.parse(clean) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

async function responseBody(url: string, label: string, accept: string, referrer?: string, body?: unknown): Promise<string> {
  const context = catalogContext.getStore();
  const execute = async (signal?: AbortSignal, recovery = false) => {
    const attempts = recovery ? 1 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      signal?.throwIfAborted();
      if (attempt > 0) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, RETRY_DELAY_MS);
        signal?.addEventListener("abort", abort, { once: true });
      });
      try {
        const response = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: { "User-Agent": USER_AGENT, Accept: accept, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(referrer ? { Referer: referrer } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
        });
        if (response.ok) return await response.text();
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500) throw new Error(`${label} failed (${response.status})`);
        const retryAfter = retryAfterDelay(response.headers.get("retry-after"));
        if (response.status === 429 || retryAfter > 0 || attempt === attempts - 1) throw new CatalogNetworkError(`${label} failed (${response.status})`, retryAfter);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) throw new CatalogNetworkError(`${label}: ${error.message}`);
        throw error;
      }
    }
    throw new Error(`${label} failed`);
  };
  if (!context) return execute();
  const ttl = /schedule lookup/.test(label) ? 5 * 60_000 : /schedule artwork/.test(label) ? 7 * 24 * 60 * 60_000 : /search|server lookup|stream lookup/.test(label) ? 60_000 : /episode lookup/.test(label) ? 30_000 : 20_000;
  return catalogRequests.read(JSON.stringify([url, accept, referrer, body]), new URL(url).origin, ttl, execute, context);
}
const fetchText = (url: string, label: string, referrer?: string) => responseBody(url, label, "text/html,application/json;q=0.9,*/*;q=0.8", referrer);
const fetchJson = async (url: string, label: string, referrer?: string): Promise<unknown> => JSON.parse(await responseBody(url, label, "application/json", referrer));
const postJson = async (url: string, body: unknown, label: string, referrer?: string): Promise<unknown> => JSON.parse(await responseBody(url, label, "application/json", referrer, body));

function splitId(id: string): { provider: ProviderName; value: string } {
  const separator = id.indexOf(":");
  if (separator >= 0) {
    const provider = id.slice(0, separator);
    if (!isProviderName(provider)) throw new Error("Unknown source provider");
    return { provider, value: id.slice(separator + 1) };
  }
  return { provider: "anidb", value: id };
}

export async function searchOne(query: string, provider: ProviderName, config: SourceConfig): Promise<AnimeResult[]> {
  if (provider === "aniwave") {
    const root = sourceBase(config.aniwaveBaseUrl);
    return parseAniwaveSearch(await fetchText(`${root}/filter?keyword=${encodeURIComponent(query)}`, "AniWave search", `${root}/`));
  }
  if (provider === "hianime") {
    const root = sourceBase(config.hianimeBaseUrl);
    return parseHiAnimeSearch(await postJson(`${HIANIME_API_BASE}/search`, { title: query }, "HiAnime search", `${root}/`));
  }
  const root = sourceBase(config.anidbBaseUrl);
  return parseSearchPage(await fetchText(`${root}/browse?q=${encodeURIComponent(query)}`, "AniDB search", `${root}/`));
}

export async function getAniwaveSchedule(query: ScheduleQuery, config: SourceConfig): Promise<ScheduleResult> {
  const root = sourceBase(config.aniwaveBaseUrl);
  const params = new URLSearchParams({ tz: "0" });
  if (query.mode === "dub") params.set("dub", "1");
  const start = Date.parse(query.utcStart), end = Date.parse(query.utcEnd);
  const utcDates: string[] = [];
  const day = new Date(start); day.setUTCHours(0, 0, 0, 0);
  for (; day.getTime() < end; day.setUTCDate(day.getUTCDate() + 1)) utcDates.push(day.toISOString().slice(0, 10));
  // AniWave drops releases crossing midnight when tz is nonzero. Fetch complete UTC days,
  // then group locally. URLs share the existing request cache across neighboring day tabs.
  // All dates must succeed so a partial response cannot replace a complete saved schedule.
  const pages = await Promise.all(utcDates.map(async (date) => parseAniwaveSchedule(
    await fetchJson(`${root}/ajax/schedule/date?${new URLSearchParams({ ...Object.fromEntries(params), time: date })}`, "AniWave schedule lookup", `${root}/`),
    date,
    0
  )));
  const unique = new Map<string, ScheduleResult["entries"][number]>();
  for (const entry of pages.flat()) {
    const release = Date.parse(entry.releaseAt);
    if (release >= start && release < end) unique.set(`${entry.episode.id}|${entry.releaseAt}`, entry);
  }
  const entries = [...unique.values()].sort((left, right) => left.releaseAt.localeCompare(right.releaseAt) || left.anime.title.localeCompare(right.anime.title));
  return { provider: "aniwave", requestedDate: query.date, entries, refreshedAt: new Date().toISOString(), status: "fresh" };
}

export async function getAniwaveScheduleArtwork(animeId: string, config: SourceConfig): Promise<ScheduleArtwork> {
  const match = animeId.match(/^aniwave:([a-z0-9-]+)-(\d+)$/i);
  if (!match) throw new Error("Invalid AniWave anime identifier");
  const root = sourceBase(config.aniwaveBaseUrl);
  const value = parseAniwaveTooltip(await fetchText(`${root}/ajax/anime/tooltip/${match[2]}`, "AniWave series metadata", `${root}/`), animeId);
  if (!value.poster) value.poster = parseAniwavePoster(await fetchText(`${root}/watch/${match[1]}-${match[2]}`, "AniWave schedule artwork", `${root}/`));
  return value;
}

export async function getProviderSeriesMetadata(sourceId: string, config: SourceConfig): Promise<ProviderSeriesMetadata> {
  const { provider, value } = splitId(sourceId);
  let fields;
  if (provider === "aniwave") {
    const match = value.match(/^[a-z0-9-]+-(\d+)$/i);
    if (!match) throw new Error("Invalid AniWave anime identifier");
    const root = sourceBase(config.aniwaveBaseUrl);
    fields = parseAniwaveSeriesMetadata(await fetchText(`${root}/ajax/anime/tooltip/${match[1]}`, "AniWave series metadata", `${root}/`));
  } else if (provider === "hianime") {
    if (!/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(value)) throw new Error("Invalid HiAnime anime identifier");
    fields = parseHiAnimeSeriesMetadata(await fetchJson(`${HIANIME_API_BASE}/anime/${encodeURIComponent(value)}`, "HiAnime series metadata", `${sourceBase(config.hianimeBaseUrl)}/`));
  } else {
    const match = value.match(/^[a-z0-9-]+-(\d+)$/i);
    if (!match) throw new Error("Invalid AniDB anime identifier");
    const root = sourceBase(config.anidbBaseUrl);
    fields = parseAniDbSeriesMetadata(await fetchJson(`${root}/api/frontend/anime/${match[1]}`, "AniDB series metadata", `${root}/`));
  }
  return { sourceId, provider, ...fields, checkedAt: Date.now() };
}

const RESOLVE_QUERIES = 3;

/** Resolve each provider independently; an outage stops alias attempts for that provider. */
export async function resolveSource(anime: AnimeResult, provider: ProviderName, config: SourceConfig): Promise<{ hit: AnimeResult; exact: boolean } | undefined> {
  const known = animeSources(anime);
  const queries = [...new Set([anime.title, ...known.flatMap((source) => [source.title, ...source.aliases])].map((value) => value.trim()).filter(Boolean))].slice(0, RESOLVE_QUERIES);
  let likely: AnimeResult | undefined;
  for (const query of queries) {
    const hits = await searchOne(query, provider, config);
    for (const hit of hits) {
      const match = sourceMatch(anime, hit);
      if (match === "exact") return { hit, exact: true };
      if (match === "likely" && !likely) likely = hit;
    }
  }
  return likely ? { hit: likely, exact: false } : undefined;
}

// Exhaustive registration makes every new provider implement the complete-page contract.
const episodeLoaders: Record<ProviderName, (value: string, config: SourceConfig) => AsyncGenerator<Episode[]>> = {
  async *aniwave(value, config) {
    if (!/^[a-z0-9-]+-\d+$/i.test(value)) throw new Error("Invalid AniWave anime identifier");
    const numeric = value.slice(value.lastIndexOf("-") + 1);
    yield parseAniwaveEpisodes(await fetchJson(`${sourceBase(config.aniwaveBaseUrl)}/ajax/episode/list/${numeric}?vrf=`, "AniWave episode lookup"), numeric);
  },
  async *hianime(value, config) {
    if (!/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(value)) throw new Error("Invalid HiAnime anime identifier");
    const referrer = `${sourceBase(config.hianimeBaseUrl)}/`;
    const payload = await fetchJson(`${HIANIME_API_BASE}/anime/${encodeURIComponent(value)}`, "HiAnime episode lookup", referrer);
    const anime = payload && typeof payload === "object" && "anime" in payload ? payload.anime : undefined;
    if (!anime || typeof anime !== "object") throw new Error("HiAnime episode metadata response has changed");
    const record = anime as Record<string, unknown>;
    const total = positiveInteger(record.totalEpisodes);
    if (total && total > MAX_EPISODES) throw new Error("HiAnime episode catalog exceeded its limit");
    // The anime response may embed only episode 1. The website loads the catalog in ranges of 100.
    if (typeof record._id !== "string" || !/^[a-f\d]{24}$/i.test(record._id)) {
      throw new Error("HiAnime episode metadata is missing its catalog identifier");
    }
    for (let start = 1; start <= (total ?? MAX_EPISODES); start += 100) {
      catalogContext.getStore()?.signal.throwIfAborted();
      const end = Math.min(start + 99, total ?? MAX_EPISODES);
      const page = await fetchJson(`${HIANIME_API_BASE}/episodes/${record._id}?start=${start}&end=${end}`, "HiAnime episode lookup", referrer);
      if (!page || typeof page !== "object" || !("episodes" in page) || !Array.isArray(page.episodes)) {
        throw new Error(`HiAnime episode range ${start}-${end} response has changed`);
      }
      const episodes = parseHiAnimeEpisodes({ anime: { episodes: page.episodes } });
      if (page.episodes.some((item) => parseHiAnimeEpisodes({ anime: { episodes: [item] } }).length !== 1)) {
        throw new Error(`HiAnime episode range ${start}-${end} contains an unreadable episode`);
      }
      yield episodes;
      // Unknown totals are discovered by walking ranges until the endpoint returns an empty range.
      if (!total && !page.episodes.length) return;
    }
    if (!total) throw new Error("HiAnime episode pagination exceeded its limit");
  },
  async *anidb(value, config) {
    if (!/^[a-z0-9-]+-\d+$/i.test(value)) throw new Error("Invalid AniDB anime identifier");
    const numeric = value.slice(value.lastIndexOf("-") + 1);
    yield parseEpisodes(await fetchJson(`${sourceBase(config.anidbBaseUrl)}/api/frontend/anime/${numeric}/episodes`, "AniDB episode lookup"));
  }
};

/** The only episode-list entry point: callers receive a complete catalog or a failure, never a successful prefix. */
export async function getProviderEpisodes(animeId: string, config: SourceConfig): Promise<Episode[]> {
  const { provider, value } = splitId(animeId);
  return collectEpisodePages(provider, episodeLoaders[provider](value, config), catalogContext.getStore()?.signal);
}

async function getEpisodeServers(episodeId: string, config: SourceConfig): Promise<unknown> {
  const { provider, value } = splitId(episodeId);
  if (provider === "aniwave") {
    const match = value.match(/^(\d+):([0-9.]+)$/);
    if (!match) throw new Error("Invalid AniWave episode identifier");
    const root = sourceBase(config.aniwaveBaseUrl);
    return fetchJson(`${root}/ajax/server/list?servers=${encodeURIComponent(match[1])}&eps=${encodeURIComponent(match[2])}`, "AniWave server lookup", `${root}/`);
  }
  if (provider === "hianime") {
    if (!/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(value)) throw new Error("Invalid HiAnime episode identifier");
    return fetchJson(`${HIANIME_API_BASE}/episode/${encodeURIComponent(value)}`, "HiAnime stream lookup", `${sourceBase(config.hianimeBaseUrl)}/`);
  }
  if (!/^\d+$/.test(value)) throw new Error("Invalid AniDB episode identifier");
  return fetchJson(`${sourceBase(config.anidbBaseUrl)}/api/frontend/episode/${value}/languages`, "AniDB stream lookup");
}

export async function getAvailability(episodeId: string, config: SourceConfig): Promise<EpisodeAvailability> {
  const { provider } = splitId(episodeId);
  const payload = await getEpisodeServers(episodeId, config);
  const listed = (mode: TranslationMode) => provider === "aniwave" ? Boolean(parseAniwaveVidplayId(payload, mode))
    : provider === "hianime" ? hiAnimeEmbedUrls(payload, mode).some((value) => { try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "zokoanime.video"; } catch { return false; } })
    : Boolean(findEmbedUrl(payload, mode));
  return { sub: listed("sub"), dub: listed("dub"), checkedAt: Date.now() };
}

export async function getStreams(episodeId: string, mode: TranslationMode, config: SourceConfig): Promise<Stream[]> {
  const { provider, value } = splitId(episodeId);
  if (provider === "aniwave") {
    const match = value.match(/^(\d+):([0-9.]+)$/);
    if (!match) throw new Error("Invalid AniWave episode identifier");
    const root = sourceBase(config.aniwaveBaseUrl);
    const servers = await getEpisodeServers(episodeId, config);
    const linkId = parseAniwaveVidplayId(servers, mode);
    if (!linkId) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} Vidplay server is available`);
    const source = await fetchJson(`${root}/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=0`, "AniWave source lookup", `${root}/`);
    const embedUrl = parseResultUrl(source);
    if (!embedUrl) throw new Error("AniWave returned no Vidplay URL");
    const embed = new URL(absolute(embedUrl, root));
    const token = embed.pathname.match(/\/embed-1\/([^/?]+)/)?.[1];
    if (!token) throw new Error("Vidplay response has changed");
    const direct = await fetchJson(`${embed.origin}/embed-1/getSources?id=${encodeURIComponent(token)}`, "Vidplay source lookup", embed.toString());
    const rawMaster = parseVidplaySource(direct);
    if (!rawMaster) throw new Error("Vidplay returned no playable stream");
    const masterUrl = absolute(rawMaster, embed.origin);
    return parseMasterPlaylist(await fetchText(masterUrl, "Video playlist", embed.toString()), masterUrl, "aniwave", embed.toString());
  }
  if (provider === "hianime") {
    if (!/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(value)) throw new Error("Invalid HiAnime episode identifier");
    const root = sourceBase(config.hianimeBaseUrl);
    const payload = await getEpisodeServers(episodeId, config);
    const candidates = hiAnimeEmbedUrls(payload, mode);
    if (candidates.length === 0) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} HiAnime source is available`);
    const failures: string[] = [];
    for (const candidate of candidates) {
      let embed: URL;
      try { embed = new URL(candidate); } catch { failures.push("invalid embed URL"); continue; }
      if (embed.protocol !== "https:" || embed.hostname !== "zokoanime.video") { failures.push(`unsupported host ${embed.hostname || "unknown"}`); continue; }
      try {
        const parsed = parseHiAnimeEmbed(await fetchText(embed.toString(), "HiAnime video host", `${root}/`));
        if (!parsed) { failures.push(`${embed.hostname} response changed`); continue; }
        const masterUrl = absolute(parsed.src, embed.origin);
        return parseMasterPlaylist(await fetchText(masterUrl, "Video playlist", embed.toString()), masterUrl, "hianime", embed.toString())
          .map((stream) => ({ ...stream, textTracks: parsed.subtitles }));
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    throw new Error(`No supported HiAnime server could be resolved: ${failures.join("; ")}`);
  }
  if (!/^\d+$/.test(value)) throw new Error("Invalid AniDB episode identifier");
  const root = sourceBase(config.anidbBaseUrl);
  const payload = await getEpisodeServers(episodeId, config);
  const embedUrl = findEmbedUrl(payload, mode);
  if (!embedUrl) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} source is available`);
  const embedPage = await fetchText(absolute(embedUrl, root), "Video host", root);
  const rawMasterUrl = parseMasterUrl(embedPage);
  if (!rawMasterUrl) throw new Error("The video host response has changed");
  const masterUrl = absolute(rawMasterUrl, embedUrl);
  return parseMasterPlaylist(await fetchText(masterUrl, "Video playlist", embedUrl), masterUrl, "anidb", embedUrl);
}

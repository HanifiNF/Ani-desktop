import type { AnimeResult, Episode, ProviderName, ScheduleArtwork, ScheduleEntry, Stream, TextTrackSource, TranslationMode } from "../shared/contracts";

const decodeEntities = (value: string): string =>
  value
    .replaceAll("&#039;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

export function parseSearchPage(html: string): AnimeResult[] {
  const normalized = html.replace(/\r?\n/g, " ");
  const results = new Map<string, AnimeResult>();
  const anchorPattern = /<a\s+[^>]*href=["'][^"']*\/anime\/([a-z0-9-]+-\d+)["'][^>]*>[\s\S]*?<img\s+([^>]+)>/gi;

  for (const match of normalized.matchAll(anchorPattern)) {
    const attributes = match[2];
    const title = attributes.match(/alt=["']([^"']+)["']/i)?.[1];
    if (!title) continue;
    const poster = attributes.match(/(?:src|data-src)=["']([^"']+)["']/i)?.[1];
    const decodedTitle = decodeEntities(title.trim());
    const id = `anidb:${match[1]}`;
    const decodedPoster = poster ? decodeEntities(poster) : undefined;
    results.set(match[1], {
      id, title: decodedTitle, poster: decodedPoster, provider: "anidb",
      sources: [{ id, provider: "anidb", title: decodedTitle, aliases: [decodedTitle], poster: decodedPoster }]
    });
  }

  // Keep compatibility with the compact markup consumed by ani-cli v5.
  if (results.size === 0) {
    const fallback = /anime\/([a-z0-9-]+-\d+)["'][^>]*[\s\S]*?alt=["']([^"']+)["']/gi;
    for (const match of normalized.matchAll(fallback)) {
      const id = `anidb:${match[1]}`, title = decodeEntities(match[2].trim());
      results.set(match[1], { id, title, provider: "anidb", sources: [{ id, provider: "anidb", title, aliases: [title] }] });
    }
  }

  return [...results.values()];
}

function visitObjects(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitObjects(item, visitor));
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    visitor(record);
    Object.values(record).forEach((item) => visitObjects(item, visitor));
  }
}

export function parseEpisodes(payload: unknown): Episode[] {
  const episodes = new Map<number, Episode>();
  visitObjects(payload, (record) => {
    const id = Number(record.id);
    const number = record.number;
    if (Number.isFinite(id) && (typeof number === "number" || typeof number === "string")) {
      episodes.set(id, { id: `anidb:${id}`, number: String(number), provider: "anidb" });
    }
  });
  return [...episodes.values()].sort((a, b) => Number(a.number) - Number(b.number));
}

export function findEmbedUrl(payload: unknown, mode: TranslationMode): string | undefined {
    const language = mode === "dub" ? "eng" : "jpn";
    let found: string | undefined;
    visitObjects(payload, (record) => {
      if (found) return;
    const nested = record[language];
    if (nested && typeof nested === "object") {
      const url = (nested as Record<string, unknown>).embed_url;
      if (typeof url === "string") found = url.replaceAll("\\/", "/");
    }
    if (typeof record.embed_url === "string") {
      const hasLanguage = Object.entries(record).some(
        ([key, value]) => key.toLowerCase() === language || (typeof value === "string" && value.toLowerCase() === language)
      );
      if (hasLanguage) found = record.embed_url.replaceAll("\\/", "/");
    }
  });
  return found;
}

export function parseMasterUrl(html: string): string | undefined {
  return html.match(/file\s*:\s*["']([^"']+)["']/i)?.[1];
}

export function parseMasterPlaylist(playlist: string, masterUrl: string, provider: ProviderName = "anidb", referrer?: string): Stream[] {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  const streams: Stream[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const metadata = lines[index];
    if (!metadata.startsWith("#EXT-X-STREAM-INF")) continue;
    const path = lines.slice(index + 1).find((line) => line && !line.startsWith("#"));
    if (!path) continue;
    const height = metadata.match(/RESOLUTION=\d+x(\d+)/i)?.[1];
    const bandwidth = Number(metadata.match(/BANDWIDTH=(\d+)/i)?.[1] ?? 0);
    streams.push({
      quality: height ? `${height}p` : bandwidth ? `${Math.round(bandwidth / 1000)}kbps` : "auto",
      url: new URL(path, masterUrl).toString(),
      masterUrl,
      provider,
      referrer
    });
  }

  if (streams.length === 0 && playlist.includes("#EXTM3U")) streams.push({ quality: "best", url: masterUrl, provider, referrer });
  return streams.sort((a, b) => Number.parseInt(b.quality) - Number.parseInt(a.quality));
}

export function parseAniwaveSearch(html: string): AnimeResult[] {
  const results = new Map<string, AnimeResult>();
  const anchors = /<a\b([^>]*\bclass=["'][^"']*\b(?:name|d-title)\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const href = match[1].match(/\bhref=["']\/watch\/([^"'/?#]+)["']/i)?.[1];
    const romanized = match[1].match(/\bdata-jp=["']([^"']+)["']/i)?.[1];
    const displayed = match[2].replace(/<[^>]+>/g, "").trim();
    const title = displayed || romanized;
    if (!href || !title || !/-\d+$/.test(href)) continue;
    const vicinity = html.slice(Math.max(0, match.index! - 900), match.index! + match[0].length);
    const poster = vicinity.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    const id = `aniwave:${href}`, decodedTitle = decodeEntities(title), decodedPoster = poster ? decodeEntities(poster) : undefined;
    const aliases = [...new Set([decodedTitle, romanized && decodeEntities(romanized)].filter((value): value is string => Boolean(value)))];
    results.set(href, { id, title: decodedTitle, poster: decodedPoster, provider: "aniwave", sources: [{ id, provider: "aniwave", title: decodedTitle, aliases, poster: decodedPoster }] });
  }
  return [...results.values()];
}

function resultHtml(payload: unknown): string {
  if (!payload || typeof payload !== "object" || typeof (payload as Record<string, unknown>).result !== "string") return "";
  return ((payload as Record<string, unknown>).result as string).replaceAll("\\/", "/");
}

export function parseAniwaveEpisodes(payload: unknown, animeNumericId: string): Episode[] {
  const episodes = new Map<string, Episode>();
  for (const match of resultHtml(payload).matchAll(/<a\b[^>]*\bdata-num=["']([^"']+)["'][^>]*>/gi)) {
    const number = decodeEntities(match[1]);
    episodes.set(number, { id: `aniwave:${animeNumericId}:${number}`, number, provider: "aniwave" });
  }
  return [...episodes.values()].sort((a, b) => Number(a.number) - Number(b.number));
}

function attribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
}

function releaseTimestamp(date: string, time: string, timezoneOffset: number): string | undefined {
  const dateParts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeParts = time.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!dateParts || !timeParts) return undefined;
  const sourceHour = Number(timeParts[1]), minute = Number(timeParts[2]);
  if (sourceHour < 1 || sourceHour > 12 || minute > 59) return undefined;
  let hour = sourceHour % 12;
  if (timeParts[3].toUpperCase() === "PM") hour += 12;
  const value = Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]), hour, minute) - timezoneOffset * 60_000;
  return Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

/** Parse either the full schedule response or one date response without trusting remote markup in the renderer. */
export function parseAniwaveSchedule(payload: unknown, requestedDate: string, timezoneOffset: number): { supportedDates: string[]; entries: ScheduleEntry[] } {
  const html = resultHtml(payload);
  const supportedDates = [...new Set([...html.matchAll(/\bdata-time=["'](\d{4}-\d{2}-\d{2})["']/gi)].map((match) => match[1]))];
  const entries: ScheduleEntry[] = [];
  const anchors = /<a\b([^>]*\bclass=["'][^"']*\bitem\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const href = attribute(match[1], "href")?.match(/^\/watch\/([^/?#]+)\/ep-([0-9.]+)$/i);
    if (!href || !/-\d+$/.test(href[1])) continue;
    const timeTag = match[2].match(/<div\b([^>]*\bclass=["'][^"']*\btime\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/i);
    const titleTag = match[2].match(/<div\b([^>]*\bclass=["'][^"']*\btitle\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/i);
    const episodeText = match[2].match(/<div\b[^>]*\bclass=["'][^"']*\bep\b[^"']*["'][^>]*>[\s\S]*?<span[^>]*>\s*Episode\s+([0-9.]+)\s*<\/span>/i)?.[1] ?? href[2];
    if (!timeTag || !titleTag) continue;
    const timeLabel = decodeEntities(timeTag[2].replace(/<[^>]+>/g, "").trim());
    const releaseAt = releaseTimestamp(requestedDate, timeLabel, timezoneOffset);
    const title = decodeEntities(titleTag[2].replace(/<[^>]+>/g, "").trim());
    const romanized = attribute(titleTag[1], "data-jp");
    const numeric = attribute(timeTag[1], "data-tip") ?? href[1].match(/-(\d+)$/)?.[1];
    if (!releaseAt || !title || !numeric || !/^\d+$/.test(numeric)) continue;
    const id = `aniwave:${href[1]}`;
    const aliases = [...new Set([title, romanized && decodeEntities(romanized)].filter((value): value is string => Boolean(value)))];
    const source = { id, provider: "aniwave" as const, title, aliases };
    entries.push({
      anime: { id, title, provider: "aniwave", sources: [source] },
      episode: { id: `aniwave:${numeric}:${episodeText}`, number: episodeText, provider: "aniwave" },
      releaseAt, timeLabel
    });
  }
  entries.sort((left, right) => left.releaseAt.localeCompare(right.releaseAt) || left.anime.title.localeCompare(right.anime.title));
  return { supportedDates, entries };
}

export function parseAniwaveTooltip(html: string, animeId: string): ScheduleArtwork {
  const titleTag = html.match(/<div\b([^>]*\bclass=["'][^"']*\btitle\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/i);
  const title = titleTag ? decodeEntities(titleTag[2].replace(/<[^>]+>/g, "").trim()) : undefined;
  const romanized = titleTag ? attribute(titleTag[1], "data-jp") : undefined;
  const other = html.match(/<span>\s*Other names:\s*<\/span>\s*<span>([\s\S]*?)<\/span>/i)?.[1]
    ?.replace(/<[^>]+>/g, "").split(",").map((value) => decodeEntities(value.trim())).filter(Boolean) ?? [];
  const rawPoster = html.match(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i)?.[1];
  let poster: string | undefined;
  if (rawPoster) {
    try { const value = new URL(decodeEntities(rawPoster)); if (/^https?:$/.test(value.protocol)) poster = value.toString(); } catch { /* malformed remote artwork */ }
  }
  return { animeId, title, aliases: [...new Set([title, romanized && decodeEntities(romanized), ...other].filter((value): value is string => Boolean(value)))], poster };
}

export function parseAniwavePoster(html: string): string | undefined {
  const raw = html.match(/<img\b[^>]*\bitemprop=["']image["'][^>]*(?:data-src|src)=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta\b[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["']([^"']+)["']/i)?.[1];
  if (!raw) return undefined;
  try { const value = new URL(decodeEntities(raw)); return /^https?:$/.test(value.protocol) ? value.toString() : undefined; }
  catch { return undefined; }
}

export function parseAniwaveVidplayId(payload: unknown, mode: TranslationMode): string | undefined {
  const html = resultHtml(payload);
  const sections = [...html.matchAll(/<div\b[^>]*\bclass=["'][^"']*\btype\b[^"']*["'][^>]*\bdata-type=["']([^"']+)["'][^>]*>([\s\S]*?)(?=<div\b[^>]*\bclass=["'][^"']*\btype\b|$)/gi)];
  const section = sections.find((item) => item[1].toLowerCase() === mode)?.[2] ?? "";
  const item = section.match(/<li\b[^>]*\bdata-sv-id=["']4["'][^>]*>/i)?.[0];
  return item?.match(/\bdata-link-id=["']([^"']+)["']/i)?.[1];
}

export function parseResultUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const result = (payload as Record<string, unknown>).result;
  if (result && typeof result === "object" && typeof (result as Record<string, unknown>).url === "string") return ((result as Record<string, unknown>).url as string).replaceAll("\\/", "/");
  if (typeof result !== "string") return undefined;
  try { const nested = JSON.parse(result) as { url?: unknown }; return typeof nested.url === "string" ? nested.url.replaceAll("\\/", "/") : undefined; }
  catch { return result.startsWith("http") ? result.replaceAll("\\/", "/") : undefined; }
}

export function parseVidplaySource(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const sources = (payload as Record<string, unknown>).sources;
  if (typeof sources === "string") return sources.replaceAll("\\/", "/");
  if (!Array.isArray(sources)) return undefined;
  const source = sources.find((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).file === "string") as Record<string, unknown> | undefined;
  return typeof source?.file === "string" ? source.file.replaceAll("\\/", "/") : undefined;
}

const stringValue = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === "string" && record[key] ? record[key] as string : undefined;

export function parseHiAnimeSearch(payload: unknown): AnimeResult[] {
  if (typeof payload === "string") {
    try { return parseHiAnimeSearch(JSON.parse(payload)); } catch { return []; }
  }
  if (!Array.isArray(payload)) return [];
  const results = new Map<string, AnimeResult>();
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const slugs = Array.isArray(record.slugs) ? record.slugs.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
    const slug = stringValue(record, "slug") ?? slugs[10] ?? slugs[0];
    const title = stringValue(record, "English") ?? stringValue(record, "title");
    if (!slug || !title || !/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(slug)) continue;
    const poster = stringValue(record, "image");
    const aliases = [...new Set([title, stringValue(record, "title"), stringValue(record, "Japanese"), stringValue(record, "alternateTitle")].filter((value): value is string => Boolean(value)))];
    const id = `hianime:${slug}`;
    results.set(slug, { id, title, poster, provider: "hianime", sources: [{ id, title, aliases, poster, provider: "hianime" }] });
  }
  return [...results.values()];
}

export function parseHiAnimeEpisodes(payload: unknown): Episode[] {
  if (typeof payload === "string") {
    try { return parseHiAnimeEpisodes(JSON.parse(payload)); } catch { return []; }
  }
  if (!payload || typeof payload !== "object") return [];
  const anime = (payload as Record<string, unknown>).anime;
  if (!anime || typeof anime !== "object") return [];
  const raw = (anime as Record<string, unknown>).episodes;
  if (!Array.isArray(raw)) return [];
  const episodes = new Map<string, Episode>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const slug = stringValue(record, "slug") ?? (Array.isArray(record.slugs) ? record.slugs.find((value): value is string => typeof value === "string" && value.length > 0) : undefined);
    const number = record.episodeNumber;
    if (!slug || (typeof number !== "number" && typeof number !== "string")) continue;
    episodes.set(slug, { id: `hianime:${slug}`, number: String(number), provider: "hianime" });
  }
  return [...episodes.values()].sort((a, b) => Number(a.number) - Number(b.number));
}

export function hiAnimeEmbedUrls(payload: unknown, mode: TranslationMode): string[] {
  if (typeof payload === "string") {
    try { return hiAnimeEmbedUrls(JSON.parse(payload), mode); } catch { return []; }
  }
  if (!payload || typeof payload !== "object") return [];
  const episode = (payload as Record<string, unknown>).episode;
  if (!episode || typeof episode !== "object") return [];
  const link = (episode as Record<string, unknown>).link;
  if (!link || typeof link !== "object") return [];
  const urls = (link as Record<string, unknown>)[mode];
  return Array.isArray(urls) ? urls.filter((value): value is string => typeof value === "string") : [];
}

interface HiAnimeEmbedSource { src: string; subtitles: TextTrackSource[]; }

export function parseHiAnimeEmbed(html: string): HiAnimeEmbedSource | undefined {
  const blob = html.match(/window\.__P\s*=\s*["']([^"']+)["']/)?.[1];
  if (!blob) return undefined;
  try {
    const encoded = Buffer.from(blob, "base64");
    const key = Buffer.from("otaku-embed-v1", "utf8");
    const decoded = Buffer.alloc(encoded.length);
    for (let index = 0; index < encoded.length; index += 1) decoded[index] = encoded[index] ^ key[index % key.length];
    const record = JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
    if (typeof record.src !== "string") return undefined;
    const subtitles = Array.isArray(record.subtitles) ? record.subtitles.flatMap((item): TextTrackSource[] => {
      if (!item || typeof item !== "object") return [];
      const track = item as Record<string, unknown>;
      return typeof track.src === "string" ? [{ src: track.src, label: typeof track.label === "string" ? track.label : "Subtitles", lang: typeof track.lang === "string" ? track.lang : "und", default: track.default === true }] : [];
    }) : [];
    return { src: record.src, subtitles };
  } catch { return undefined; }
}

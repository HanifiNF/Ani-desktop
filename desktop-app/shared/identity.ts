import type { AnimeResult, AnimeSource, IdentityCandidate, LibraryEntry, MediaType, ProviderName } from "./contracts";

/*
 * Title matching for anime identity. Everything here is pure and shared by the main process and the renderer.
 *
 * A provider record names an anime with a title and aliases and sometimes states facts about it (type, year, episode
 * count, an external reference). Two records name the same anime when they share a reference, share a normalised
 * title or alias, or name the same season of the same title with no conflicting fact. Season markers are compared
 * strictly: "Part 2" and "2nd Season" are different things, and a franchise prefix on its own proves nothing.
 */

export const REF_PATTERN = /^(mal|anilist|anidb|kitsu):\d{1,9}$/;
export const isRef = (value: unknown): value is string => typeof value === "string" && REF_PATTERN.test(value);
export const ref = (namespace: "mal" | "anilist" | "anidb" | "kitsu", id: number | string): string => `${namespace}:${id}`;

export function providerOf(id: string): ProviderName {
  return id.startsWith("aniwave:") ? "aniwave" : id.startsWith("hianime:") ? "hianime" : "anidb";
}

export function sourcesOf(anime: AnimeResult | LibraryEntry): AnimeSource[] {
  if (anime.sources?.length) return anime.sources;
  const id = "animeId" in anime ? anime.animeId : anime.id;
  return [{ id, provider: providerOf(id), title: anime.title, aliases: [anime.title], poster: anime.poster }];
}

/** Every external reference known for an anime: the row's own and each source's. */
export function refsOf(anime: AnimeResult | LibraryEntry): string[] {
  const own = "refs" in anime && Array.isArray(anime.refs) ? anime.refs : [];
  return unique([...own, ...sourcesOf(anime).flatMap((source) => source.refs ?? [])].filter(isRef));
}

export const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

/** Different IDs from the same catalogue are a contradiction, even when titles agree. */
export function conflictingRefs(left: string[], right: string[]): boolean {
  return left.some((a) => right.some((b) => a.split(":")[0] === b.split(":")[0] && a !== b));
}

export function normalizedTitle(value: string): string {
  return value.normalize("NFKD").toLowerCase()
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

// Words that describe a release of the anime rather than the anime itself.
const QUALIFIER = /\b(?:uncensored|censored|uncut|dubbed|dub|subbed|sub|english dub|remastered)\b/g;
const stripQualifiers = (normalized: string): string => normalized.replace(QUALIFIER, " ").replace(/\s+/g, " ").trim();

/** Normalised titles and aliases, plus the same with release qualifiers removed. */
export function titleKeys(source: { title: string; aliases?: string[] }): Set<string> {
  const keys = new Set<string>();
  for (const value of [source.title, ...(source.aliases ?? [])]) {
    const normalized = normalizedTitle(value);
    if (!normalized) continue;
    keys.add(normalized);
    const stripped = stripQualifiers(normalized);
    if (stripped) keys.add(stripped);
  }
  return keys;
}

/** Whether two records share a title key only through a release qualifier, such as "(Uncensored)". */
export function variantTitles(left: { title: string; aliases?: string[] }, right: { title: string; aliases?: string[] }): boolean {
  const rawLeft = new Set([left.title, ...(left.aliases ?? [])].map(normalizedTitle));
  const rawRight = new Set([right.title, ...(right.aliases ?? [])].map(normalizedTitle));
  if ([...rawLeft].some((key) => key && rawRight.has(key))) return false;
  return [...titleKeys(left)].some((key) => titleKeys(right).has(key));
}

const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
// Trailing tags name a format or a year rather than the anime: "(TV)", "(Movie)", "(2012)".
const TRAILING_TAG = /\s*\((?:tv|ova|ona|movie|special|(?:19|20)\d{2})\)\s*$/i;

/**
 * Every season, part, and cour marker in a title, in order, as a signature such as "s2", "p6p3", or "s2p3".
 * "Part 6: Stone Ocean Part 2" and "Part 6: Stone Ocean Part 3" differ, and so do "Part 2" and "2nd Season".
 * A trailing small number or roman numeral counts as a season when no other marker is present; a year does not.
 */
export function seasonSignature(title: string): string {
  const normalized = normalizedTitle(title.replace(TRAILING_TAG, ""));
  const markers: string[] = [];
  for (const match of normalized.matchAll(/\b(?:(season|part|cour) (\d{1,2})|(\d{1,2}) (season)|(final) season)\b/g)) {
    if (match[1]) markers.push(`${match[1][0]}${Number(match[2])}`);
    else if (match[4]) markers.push(`s${Number(match[3])}`);
    else markers.push("sfinal");
  }
  if (markers.length === 0) {
    const trailing = normalized.match(/\s(\d{1,2})$/) ?? normalized.match(/\s(ii|iii|iv|v|vi|vii|viii|ix|x)$/);
    if (trailing) markers.push(`s${ROMAN[trailing[1]] ?? Number(trailing[1])}`);
  }
  return markers.join("");
}

/** The title with season markers, release qualifiers, and trailing type or year tags removed. */
export function coreTitle(title: string): string {
  return stripQualifiers(normalizedTitle(title.replace(TRAILING_TAG, ""))
    .replace(/\b(?:season|part|cour) \d{1,2}\b/g, " ")
    .replace(/\b\d{1,2} season\b/g, " ")
    .replace(/\bfinal season\b/g, " ")
    .replace(/\s(?:\d{1,2}|ii|iii|iv|v|vi|vii|viii|ix|x)$/, " "))
    .replace(/\s+/g, " ").trim();
}

const TYPE_WORDS: Record<string, MediaType> = {
  tv: "TV", "tv series": "TV", "tv short": "TV", ona: "ONA", ova: "OVA", movie: "MOVIE", film: "MOVIE", special: "SPECIAL", "tv special": "SPECIAL", music: "MUSIC", pv: "MUSIC"
};
export function mediaTypeOf(value: unknown): MediaType | undefined {
  if (typeof value !== "string") return undefined;
  return TYPE_WORDS[value.trim().toLowerCase().replace(/[_-]+/g, " ")];
}

/** A type stated in a trailing tag such as "(TV)" or "(Movie)". */
export function typeFromTitle(title: string): MediaType | undefined {
  const tag = title.match(/\((tv|ova|ona|movie|special)\)\s*$/i)?.[1];
  return tag ? mediaTypeOf(tag) : undefined;
}

/** A year stated in a trailing tag such as "(2012)". */
export function yearFromTitle(title: string): number | undefined {
  const tag = title.match(/\(((?:19|20)\d{2})\)\s*$/)?.[1];
  return tag ? Number(tag) : undefined;
}

export function yearOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2100) return value;
  if (typeof value !== "string") return undefined;
  const match = value.match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

export function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export interface Facts { type?: MediaType; year?: number; episodes?: number; }

export function factsOf(source: Pick<AnimeSource, "title" | "type" | "year" | "episodes">): Facts {
  return { type: source.type ?? typeFromTitle(source.title), year: source.year ?? yearFromTitle(source.title), episodes: source.episodes };
}

/** Facts for a whole row: the first stated value wins for each field. */
export function factsOfAll(sources: Pick<AnimeSource, "title" | "type" | "year" | "episodes">[]): Facts {
  const facts: Facts = {};
  for (const source of sources) {
    const own = factsOf(source);
    facts.type ??= own.type; facts.year ??= own.year; facts.episodes ??= own.episodes;
  }
  return facts;
}

/**
 * Whether two sets of facts describe different anime. Types and years must agree when both are known. Episode counts
 * are loose because a provider lists what it has while an index states the planned total.
 */
export function conflicting(left: Facts, right: Facts): boolean {
  if (left.type && right.type && left.type !== right.type) return true;
  if (left.year && right.year && left.year !== right.year) return true;
  if (left.episodes && right.episodes) {
    const high = Math.max(left.episodes, right.episodes), low = Math.min(left.episodes, right.episodes);
    if (high - low > 2 && high / low > 1.5) return true;
  }
  return false;
}

export const sameCore = (left: string, right: string): boolean => {
  const a = coreTitle(left), b = coreTitle(right);
  return a.length > 0 && a === b && seasonSignature(left) === seasonSignature(right);
};

/**
 * Whether two records, from different providers, name the same season of the same anime by title alone.
 * Facts that disagree veto the match; a shared franchise name with different season markers is never enough.
 */
export function likelyDuplicate(left: AnimeResult | LibraryEntry, right: AnimeResult | LibraryEntry): boolean {
  const leftSources = sourcesOf(left), rightSources = sourcesOf(right);
  if (leftSources.some((source) => rightSources.some((other) => other.provider === source.provider || other.id === source.id))) return false;
  if (conflicting(factsOfAll(leftSources), factsOfAll(rightSources))) return false;
  const leftTitles = unique([left.title, ...leftSources.flatMap((source) => [source.title, ...source.aliases])]);
  const rightTitles = unique([right.title, ...rightSources.flatMap((source) => [source.title, ...source.aliases])]);
  return leftTitles.some((a) => rightTitles.some((b) => sameCore(a, b)));
}

/** Candidates from an index that name this record by title or alias without contradicting its facts. */
export function matchingCandidates(source: { title: string; aliases?: string[] } & Partial<Facts>, candidates: IdentityCandidate[]): IdentityCandidate[] {
  const keys = titleKeys(source);
  const facts = factsOf({ title: source.title, type: source.type, year: source.year, episodes: source.episodes });
  return candidates.filter((candidate) => !conflicting(candidate.status === "ongoing" || candidate.status === "upcoming" ? { ...facts, episodes: undefined } : facts, candidate)
    && candidate.titles.some((title) => { const key = normalizedTitle(title); return Boolean(key) && (keys.has(key) || keys.has(stripQualifiers(key))); }));
}

/** The one work an index names for this record, or nothing when the index is ambiguous. */
export function bestCandidate(source: { title: string; aliases?: string[] } & Partial<Facts>, candidates: IdentityCandidate[]): IdentityCandidate | undefined {
  const matches = matchingCandidates(source, candidates);
  if (!matches.length) return undefined;
  const anchor = (candidate: IdentityCandidate) => candidate.refs.find((value) => value.startsWith("mal:")) ?? candidate.refs[0];
  const anchors = unique(matches.map(anchor));
  return anchors.length === 1 ? matches[0] : undefined;
}

export const mergeKey = (first: string, second: string): string => [first, second].sort().join("|");

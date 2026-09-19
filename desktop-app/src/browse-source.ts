import type { AnimeResult, BrowseAnime, IdentityCandidate, Settings, Work } from "../shared/contracts";
import { animeSources, enabledProviders, providerFromId } from "../shared/catalog";
import { conflicting, conflictingRefs, factsOf, normalizedTitle, refsOf, titleKeys, unique } from "../shared/identity";

const sharesRef = (anime: BrowseAnime, result: AnimeResult) => refsOf(result).some((ref) => anime.refs.includes(ref));

/**
 * The one provider row that names a catalogue entry. A shared catalogue id settles identity on its own: catalogues
 * disagree on the year and format of the same work, such as a December premiere filed under the next year's season.
 * Without an id, titles decide under the same fact rules as every other match, except that the announced episode
 * total is ignored because a provider lists what it has. Ambiguity resolves to nothing.
 */
export function browseMatch(anime: BrowseAnime, results: AnimeResult[]): AnimeResult | undefined {
  const compatible = results.filter((result) => !conflictingRefs(anime.refs, refsOf(result)));
  const referenced = compatible.filter((result) => sharesRef(anime, result));
  if (referenced.length) return referenced.length === 1 ? referenced[0] : undefined;
  const facts = { type: anime.type, year: anime.year };
  const agreeing = compatible.filter((result) => animeSources(result).every((source) => !conflicting(facts, { ...factsOf(source), episodes: undefined })));
  const names = [anime.title, ...anime.titles];
  const exact = new Set(names.map(normalizedTitle).filter(Boolean));
  const named = agreeing.filter((result) => animeSources(result).some((source) => [source.title, ...source.aliases].some((title) => exact.has(normalizedTitle(title)))));
  if (named.length) return named.length === 1 ? named[0] : undefined;
  // Release qualifiers such as "(Uncensored)" name a release of the same anime.
  const loose = titleKeys({ title: anime.title, aliases: anime.titles });
  const variants = agreeing.filter((result) => animeSources(result).some((source) => [...titleKeys(source)].some((key) => loose.has(key))));
  return variants.length === 1 ? variants[0] : undefined;
}

/** The matched row carrying the catalogue entry's references, so series information and the remembered work name the entry that was opened. */
export function identified(anime: BrowseAnime, match: AnimeResult): AnimeResult {
  return { ...match, refs: unique([...(match.refs ?? []), ...anime.refs]) };
}

/** The catalogue entry as search sees it: a work that is already identified. */
export function knownCandidate(anime: BrowseAnime): IdentityCandidate {
  return { refs: anime.refs, title: anime.title, titles: anime.titles, status: anime.status, ...(anime.type ? { type: anime.type } : {}), ...(anime.year ? { year: anime.year } : {}), ...(anime.episodes ? { episodes: anime.episodes } : {}) };
}

export function rememberedBrowseAnime(anime: BrowseAnime, works: Work[], settings: Pick<Settings, "disabledSources">): AnimeResult | undefined {
  const providers = enabledProviders(settings);
  const candidates = works.filter((work) => !work.tentative && !conflictingRefs(anime.refs, work.refs)
    && work.refs.some((ref) => anime.refs.includes(ref))).flatMap((work): AnimeResult[] => {
    const sources = work.records.filter((id) => providers.includes(providerFromId(id))).map((id) => ({
      id, provider: providerFromId(id), title: work.title, aliases: [], refs: work.refs, type: work.type, year: work.year
    }));
    return sources.length ? [{ ...sources[0], sources, workId: work.id, poster: anime.cover }] : [];
  });
  return browseMatch(anime, candidates);
}

/** Three distinct, complete title spellings bound the provider work for an unresolved catalogue entry. */
export async function findBrowseSource(anime: BrowseAnime, search: (query: string) => Promise<AnimeResult[]>): Promise<AnimeResult | undefined> {
  const seen = new Set<string>();
  const queries = [anime.title, ...anime.titles].map((title) => title.trim()).filter((title) => {
    const key = normalizedTitle(title);
    if (!key || title.length > 120 || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 3);
  for (const query of queries) {
    const match = browseMatch(anime, await search(query));
    if (match) return match;
  }
  return undefined;
}

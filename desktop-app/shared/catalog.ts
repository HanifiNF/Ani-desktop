import type { AnimeResult, AnimeSource, IdentityCandidate, LibraryEntry, ProviderName, Settings, Work } from "./contracts";
import { bestCandidate, conflicting, factsOf, factsOfAll, isRef, likelyDuplicate, mergeKey, providerOf, refsOf, sourcesOf, titleKeys, unique, variantTitles } from "./identity";

export { likelyDuplicate, mergeKey };

export const PROVIDER_NAMES: readonly ProviderName[] = ["aniwave", "anidb", "hianime"];
export const isProviderName = (value: unknown): value is ProviderName => PROVIDER_NAMES.includes(value as ProviderName);
/** Providers that take part in catalog work, in the app's fixed order. */
export function enabledProviders(settings: Pick<Settings, "disabledSources">): ProviderName[] {
  const disabled = settings.disabledSources ?? [];
  return PROVIDER_NAMES.filter((provider) => !disabled.includes(provider));
}

export const providerFromId = providerOf;
export const animeSources = sourcesOf;
export const sourceIds = (anime: AnimeResult | LibraryEntry): string[] => animeSources(anime).map((source) => source.id);
export const overlaps = (left: AnimeResult | LibraryEntry, right: AnimeResult | LibraryEntry): boolean => {
  const ids = new Set(sourceIds(left));
  return sourceIds(right).some((id) => ids.has(id));
};

/** Everything the grouping can consult besides the records themselves. */
export interface GroupingContext {
  /** Remembered works; a record bound to one carries its references and joins its other records. */
  works?: Work[];
  /** Works an index or metadata service names for the searched term. */
  candidates?: IdentityCandidate[];
  /** Pairs of record ids the user split apart; never grouped again automatically. */
  dismissed?: string[];
}

interface Cluster {
  sources: AnimeSource[];
  refs: Set<string>;
  workId?: string;
  /** Some record joined this row by title alone. */
  titleMerged: boolean;
  keys: Set<string>;
  /** Rows whose grouping came from an index rather than a remembered work or a stated reference. */
  candidate?: IdentityCandidate;
}
type Tier = "reference" | "alias" | "title";

const providersOf = (cluster: Cluster) => new Set(cluster.sources.map((source) => source.provider));
const overlapProviders = (a: Cluster, b: Cluster) => { const providers = providersOf(a); return b.sources.some((source) => providers.has(source.provider)); };
const shareKey = (a: Cluster, b: Cluster) => [...a.keys].some((key) => b.keys.has(key));
const shareRef = (a: Cluster, b: Cluster) => [...a.refs].some((value) => b.refs.has(value));
const asResult = (sources: AnimeSource[]): AnimeResult => ({ id: sources[0].id, title: sources[0].title, provider: sources[0].provider, sources });
const dismissedBetween = (a: Cluster, b: Cluster, dismissed: Set<string>) => dismissed.size > 0
  && a.sources.some((source) => b.sources.some((other) => dismissed.has(mergeKey(source.id, other.id))));

/** Two records from one provider are variants of one anime only through a reference or a release qualifier. */
function variants(a: Cluster, b: Cluster): boolean {
  if (conflicting(factsOfAll(a.sources), factsOfAll(b.sources))) return false;
  return a.sources.some((source) => b.sources.some((other) => source.provider === other.provider && variantTitles(source, other)));
}

/** Whether two rows belong together at the given confidence tier. Stronger tiers run to completion before weaker ones. */
function mergeable(a: Cluster, b: Cluster, tier: Tier, dismissed: Set<string>): boolean {
  const crossProvider = !overlapProviders(a, b);
  if (tier === "reference") {
    if (shareRef(a, b)) return true;
    // A remembered work that has grown to span seasons still yields one row per season.
    return Boolean(a.workId && a.workId === b.workId && (crossProvider || variants(a, b)));
  }
  if (dismissedBetween(a, b, dismissed) || conflicting(factsOfAll(a.sources), factsOfAll(b.sources))) return false;
  if (tier === "alias") return crossProvider ? shareKey(a, b) : variants(a, b);
  return crossProvider && likelyDuplicate(asResult(a.sources), asResult(b.sources));
}

function combine(target: Cluster, other: Cluster, tier: Tier): void {
  for (const source of other.sources) if (!target.sources.some((item) => item.id === source.id)) target.sources.push(source);
  for (const value of other.refs) target.refs.add(value);
  for (const key of other.keys) target.keys.add(key);
  target.workId ??= other.workId;
  target.candidate ??= other.candidate;
  target.titleMerged = target.titleMerged || other.titleMerged || tier === "title";
}

/**
 * Group provider records into one row per anime. A record joins a row through a shared external reference, a
 * remembered work, an index candidate, a shared normalised alias, or, tentatively, the same season of the same title.
 * Rows never split records that arrived grouped, so a row returned by the main process survives a second pass here.
 */
export function unifyAnimeResults(results: AnimeResult[], links: string[][] = [], context: GroupingContext = {}): AnimeResult[] {
  const works = context.works ?? [];
  const workByRecord = new Map<string, Work>();
  for (const work of works) for (const id of work.records) workByRecord.set(id, work);
  const linkIndex = new Map<string, number>();
  links.forEach((group, index) => { for (const id of group) linkIndex.set(id, index); });
  const dismissed = new Set(context.dismissed ?? []);
  const candidates = context.candidates ?? [];

  const clusters: Cluster[] = results.map((result) => {
    const sources = animeSources(result).filter((source, index, all) => all.findIndex((item) => item.id === source.id) === index);
    const cluster: Cluster = { sources, refs: new Set(refsOf(result)), workId: result.workId, titleMerged: result.tentative === true, keys: new Set() };
    for (const source of sources) {
      for (const key of titleKeys(source)) cluster.keys.add(key);
      const work = workByRecord.get(source.id);
      if (work) { cluster.workId ??= work.id; for (const value of work.refs) cluster.refs.add(value); }
      const link = linkIndex.get(source.id);
      if (link !== undefined) cluster.workId ??= `link:${link}`;
    }
    if (!cluster.refs.size && candidates.length) {
      const match = bestCandidate({ title: sources[0].title, aliases: sources.flatMap((source) => [source.title, ...source.aliases]), ...factsOfAll(sources) }, candidates);
      if (match) { cluster.candidate = match; for (const value of match.refs) cluster.refs.add(value); }
    }
    return cluster;
  });

  // Each tier runs until stable before the next: a shared reference or alias wins over a title-only match.
  for (const tier of ["reference", "alias", "title"] as const) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let left = 0; left < clusters.length && !changed; left += 1) {
        for (let right = left + 1; right < clusters.length; right += 1) {
          if (!mergeable(clusters[left], clusters[right], tier, dismissed)) continue;
          combine(clusters[left], clusters[right], tier);
          clusters.splice(right, 1);
          changed = true;
          break;
        }
      }
    }
  }

  return clusters.map((cluster) => {
    const sources = cluster.sources;
    const primary = sources.find((source) => source.provider === "aniwave") ?? sources[0];
    const english = sources.find((source) => source.provider === "aniwave")?.title ?? sources.find((source) => source.provider === "anidb")?.title ?? sources.find((source) => source.provider === "hianime")?.title ?? primary.title;
    const refs = [...cluster.refs].filter(isRef).sort();
    const workId = cluster.workId && !cluster.workId.startsWith("link:") ? cluster.workId : undefined;
    return {
      id: primary.id, title: english, poster: primary.poster ?? sources.find((source) => source.poster)?.poster, provider: primary.provider, sources,
      ...(workId ? { workId } : {}), ...(refs.length ? { refs } : {}), ...(cluster.titleMerged && sources.length > 1 ? { tentative: true } : {})
    };
  });
}

/** How confidently a search hit on another provider names the same anime: by a shared reference or alias, or by title and season. */
export function sourceMatch(anime: AnimeResult | LibraryEntry, candidate: AnimeResult): "exact" | "likely" | undefined {
  const own = new Set(refsOf(anime));
  if (refsOf(candidate).some((value) => own.has(value))) return "exact";
  if (conflicting(factsOfAll(animeSources(anime)), factsOfAll(animeSources(candidate)))) return undefined;
  const keys = new Set(animeSources(anime).flatMap((source) => [...titleKeys(source)]));
  if (animeSources(candidate).some((source) => [...titleKeys(source)].some((key) => keys.has(key)))) return "exact";
  return likelyDuplicate(anime, candidate) ? "likely" : undefined;
}

/** Add every record a remembered link ties to this anime, so library entries and player state see all sources. */
export function expandWithLinks(anime: AnimeResult, links: string[][]): AnimeResult {
  const known = animeSources(anime);
  const ids = new Set(known.map((source) => source.id));
  const linkedIds = links.filter((group) => group.some((id) => ids.has(id))).flat().filter((id) => !ids.has(id));
  if (linkedIds.length === 0) return anime;
  const merged = [...known];
  for (const id of linkedIds) {
    const provider = providerFromId(id);
    if (!merged.some((source) => source.provider === provider)) merged.push({ id, provider, title: anime.title, aliases: [anime.title] });
  }
  return merged.length > known.length ? { ...anime, sources: merged } : anime;
}

/** The facts a row states, for display and for vetoing matches. */
export const animeFacts = (anime: AnimeResult | LibraryEntry) => factsOfAll(animeSources(anime));
export { factsOf, unique };

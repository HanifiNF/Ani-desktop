import type { AnimeResult, BrowseDiscoveryResult, BrowseIdentity, IdentityCandidate, ProviderName, Work } from "../shared/contracts";
import { animeSources, enabledProviders, unifyAnimeResults } from "../shared/catalog";
import { BROWSE_QUERY_LIMIT, browseMatch, browseQueries, identified, rememberedBrowseAnime } from "../shared/browse-source";
import { catalogScope } from "../shared/settings";
import { catalogContext } from "./catalog-requests";
import { searchOne, type SourceConfig } from "./scraper";

export const BROWSE_DISCOVERY_MS = 20_000;
// Each of the five queries can make an initial request and one transport retry.
export const BROWSE_HTTP_LIMIT = BROWSE_QUERY_LIMIT * 2;
interface DiscoveryOptions { works?: Work[]; hints?: IdentityCandidate[]; refresh?: boolean; }

/** Finish promptly even when a search implementation takes time to acknowledge cancellation. */
function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

/** One opening owns all discovery. The renderer opens this completed result without resolving again. */
export class BrowseDiscovery {
  constructor(private readonly search = searchOne) {}

  async discover(anime: BrowseIdentity, config: SourceConfig, options: DiscoveryOptions = {}): Promise<BrowseDiscoveryResult> {
    const parent = catalogContext.getStore();
    parent?.signal.throwIfAborted();
    const refresh = options.refresh ?? parent?.refresh;
    const remembered = refresh ? undefined : rememberedBrowseAnime(anime, options.works ?? [], config);
    const matches: AnimeResult[] = remembered ? [identified(anime, remembered)] : [];
    const known = remembered ? animeSources(remembered) : [];
    const providers = enabledProviders(config).filter((provider) => !known.some((source) => source.provider === provider));
    const errors: Partial<Record<ProviderName, string>> = {};
    const queries = browseQueries(anime, options.hints);
    const deadline = new AbortController();
    const signal = parent ? AbortSignal.any([parent.signal, deadline.signal]) : deadline.signal;
    const timer = setTimeout(() => deadline.abort(new Error("Source discovery timed out after 20 seconds")), BROWSE_DISCOVERY_MS);
    try {
      await Promise.all(providers.map((provider) => catalogContext.run({
        ...parent, signal, refresh, priority: parent?.priority ?? 1, scope: parent?.scope ?? catalogScope(config),
        searchRequestBudget: { remaining: BROWSE_HTTP_LIMIT }
      }, async () => {
        try {
          for (const query of queries) {
            signal.throwIfAborted();
            const hits = await untilAborted(this.search(query, provider, config), signal);
            signal.throwIfAborted();
            // Index hints affect retrieval only. Match against the original catalogue identity.
            const match = browseMatch(anime, unifyAnimeResults(hits, [], { works: options.works }));
            if (match) { matches.push(identified(anime, match)); return; }
          }
        } catch (error) {
          // Empty results advance to another alias; outages stop this source for the entire opening.
          errors[provider] = error instanceof Error ? error.message : String(error);
        }
      })));
      parent?.signal.throwIfAborted();
      const resolved = unifyAnimeResults(matches)[0];
      return { ...(resolved ? { anime: resolved } : {}), errors };
    } finally { clearTimeout(timer); }
  }
}

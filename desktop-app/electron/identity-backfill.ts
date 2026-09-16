import type { AnimeResult, LibraryEntry } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import { refsOf } from "../shared/identity";
import { catalogContext } from "./catalog-requests";
import type { StateStore } from "./state";
import type { WorkInfoService } from "./work-info-service";

/*
 * Library entries saved before identity existed have no references. This low-priority pass gives each one a chance
 * to learn its ids from the metadata service, a few at a time, so library rows group and show information too.
 */
const BATCH = 25;
const PAUSE_MS = 1500;

export async function backfillLibraryIdentity(store: StateStore, info: WorkInfoService, signal: AbortSignal, pauseMs = PAUSE_MS): Promise<number> {
  const state = store.snapshot();
  if (state.settings.animeInfo === false) return 0;
  const seen = new Set<string>();
  const pending = [...state.bookmarks, ...state.history].filter((entry) => {
    if (seen.has(entry.animeId)) return false;
    seen.add(entry.animeId);
    return refsOf(store.withWork(asAnime(entry))).length === 0;
  }).slice(0, BATCH);
  let learned = 0;
  await catalogContext.run({ signal, priority: 4, scope: "identity-backfill" }, async () => {
    for (const entry of pending) {
      signal.throwIfAborted();
      const anime = store.withWork(asAnime(entry));
      try {
        const result = await info.info(anime, { enabled: true });
        if (result.refs.length) {
          await store.bindWork({ ids: animeSources(anime).map((source) => source.id), refs: result.refs, title: entry.title, sources: animeSources(anime), type: result.info?.type, year: result.info?.year, episodes: result.info?.episodes });
          learned += 1;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        // A service outage ends the pass; the next start tries again.
        if ((error as { name?: string }).name === "CatalogNetworkError") break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pauseMs));
    }
  });
  return learned;
}

const asAnime = (entry: LibraryEntry): AnimeResult => ({ id: entry.animeId, title: entry.title, poster: entry.poster, provider: animeSources(entry)[0].provider, sources: animeSources(entry) });

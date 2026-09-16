import type { Episode, ProviderName } from "../shared/contracts";

// Matches the persisted catalog's per-series limit. Exceeding it must fail rather than cache a truncated list.
export const MAX_EPISODES = 5000;

/** A provider must yield every page, and throw if any page cannot be loaded. */
export async function collectEpisodePages(provider: ProviderName, pages: AsyncIterable<Episode[]>, signal?: AbortSignal): Promise<Episode[]> {
  signal?.throwIfAborted();
  const episodes = new Map<string, Episode>();
  let count = 0;
  for await (const page of pages) {
    signal?.throwIfAborted();
    if (++count > 100) throw new Error(`${provider} episode pagination exceeded its limit`);
    for (const episode of page) {
      if (episode.provider !== provider || !episode.id.startsWith(`${provider}:`) || !/^\d+(?:\.\d+)?$/.test(episode.number)) {
        throw new Error(`${provider} returned an invalid episode`);
      }
      episodes.set(episode.id, episode);
    }
    if (episodes.size > MAX_EPISODES) throw new Error(`${provider} episode catalog exceeded its limit`);
  }
  signal?.throwIfAborted();
  return [...episodes.values()].sort((a, b) => Number(a.number) - Number(b.number) || a.id.localeCompare(b.id));
}

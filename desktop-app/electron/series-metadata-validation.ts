import type { AnimeResult } from "../shared/contracts";
import { isProviderName } from "../shared/catalog";

export function validateSeriesMetadataRequest(value: unknown): AnimeResult {
  if (!value || typeof value !== "object") throw new Error("Invalid anime metadata request");
  const anime = value as Record<string, unknown>;
  const validBase = typeof anime.id === "string" && anime.id.length <= 512 && typeof anime.title === "string" && anime.title.length <= 500
    && isProviderName(anime.provider) && anime.id.startsWith(`${anime.provider}:`);
  const validSources = anime.sources === undefined || (Array.isArray(anime.sources) && anime.sources.length <= 20 && anime.sources.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const source = raw as Record<string, unknown>;
    return typeof source.id === "string" && source.id.length <= 512 && isProviderName(source.provider) && source.id.startsWith(`${source.provider}:`)
      && typeof source.title === "string" && source.title.length <= 500 && Array.isArray(source.aliases) && source.aliases.length <= 100
      && source.aliases.every((alias) => typeof alias === "string" && alias.length <= 500);
  }));
  if (!validBase || !validSources) throw new Error("Invalid anime metadata request");
  return value as AnimeResult;
}

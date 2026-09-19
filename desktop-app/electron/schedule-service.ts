import type { ScheduleArtwork, ScheduleQuery, ScheduleResult } from "../shared/contracts";
import type { SourceConfig } from "./scraper";
import { getAniwaveSchedule, getAniwaveScheduleArtwork } from "./scraper";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Retains normalized rows after request-cache expiry so an outage does not blank the Home screen. */
export class ScheduleService {
  private readonly schedules = new Map<string, ScheduleResult>();
  private readonly artwork = new Map<string, { value: ScheduleArtwork; at: number }>();

  private key(query: ScheduleQuery, config: SourceConfig) {
    return `${config.aniwaveBaseUrl.replace(/\/$/, "")}|${query.date}|${query.utcStart}|${query.utcEnd}|${query.mode}`;
  }

  async get(query: ScheduleQuery, config: SourceConfig): Promise<ScheduleResult> {
    const key = this.key(query, config), previous = this.schedules.get(key);
    if (config.disabledSources?.includes("aniwave")) {
      const error = "Enable AniWave in Settings to load the release schedule";
      if (previous) return { ...previous, status: "stale", error };
      return { provider: "aniwave", requestedDate: query.date, entries: [], refreshedAt: new Date().toISOString(), status: "unavailable", error };
    }
    try {
      const result = await getAniwaveSchedule(query, config);
      this.schedules.set(key, result);
      while (this.schedules.size > 64) this.schedules.delete(this.schedules.keys().next().value!);
      return result;
    } catch (error) {
      if (previous) return { ...previous, status: "stale", error: message(error) };
      throw error;
    }
  }

  async getArtwork(animeId: string, config: SourceConfig): Promise<ScheduleArtwork> {
    const key = `${config.aniwaveBaseUrl.replace(/\/$/, "")}|${animeId}`;
    const previous = this.artwork.get(key);
    if (previous && Date.now() - previous.at < 7 * 24 * 60 * 60_000) return previous.value;
    if (previous) this.artwork.delete(key);
    if (config.disabledSources?.includes("aniwave")) return { animeId, aliases: [] };
    const value = await getAniwaveScheduleArtwork(animeId, config);
    this.artwork.set(key, { value, at: Date.now() });
    while (this.artwork.size > 500) this.artwork.delete(this.artwork.keys().next().value!);
    return value;
  }
}

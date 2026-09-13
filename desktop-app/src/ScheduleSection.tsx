import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnimeResult, Episode, LibraryEntry, ScheduleArtwork, ScheduleEntry, ScheduleResult, Settings, TranslationMode } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import Art from "./Art";
import { catalogRequestId } from "./catalog-request";
import { localDateKey, localWeek, releaseHasPassed, seasonScheduleTitle, timezoneOffsetEast } from "./schedule";
import { messageFrom } from "./errors";

const titleKey = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function libraryPoster(anime: AnimeResult, entries: LibraryEntry[]): string | undefined {
  const ids = new Set(animeSources(anime).map((source) => source.id));
  const aliases = new Set(animeSources(anime).flatMap((source) => [source.title, ...source.aliases]).map(titleKey));
  return entries.find((entry) => animeSources(entry).some((source) => ids.has(source.id)))?.poster
    ?? entries.find((entry) => animeSources(entry).some((source) => [source.title, ...source.aliases].some((alias) => aliases.has(titleKey(alias)))))?.poster;
}

function LazyScheduleArt({ animeId, src, onArtwork }: { animeId: string; src?: string; onArtwork: (value: ScheduleArtwork) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (src) return;
    const id = catalogRequestId("schedule-artwork");
    let requested = false;
    const load = () => {
      if (requested) return; requested = true;
      void window.aniDesktop.scheduleArtwork(animeId, { id, priority: "visible" }).then(onArtwork).catch(() => undefined);
    };
    const observer = "IntersectionObserver" in window ? new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) { observer?.disconnect(); load(); }
    }, { rootMargin: "160px" }) : undefined;
    if (observer && ref.current) observer.observe(ref.current); else load();
    return () => { observer?.disconnect(); window.aniDesktop.cancelCatalog(id); };
  }, [animeId, src, onArtwork]);
  return <span ref={ref} className="schedule-art"><Art src={src} /></span>;
}

interface Props {
  settings: Settings;
  library: LibraryEntry[];
  onOpen: (anime: AnimeResult, episode: Episode, mode: TranslationMode) => void;
}

export default function ScheduleSection({ settings, library, onOpen }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [mode, setMode] = useState<TranslationMode>(settings.preferredMode);
  const [result, setResult] = useState<ScheduleResult>();
  const [artwork, setArtwork] = useState<Record<string, ScheduleArtwork>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const todayRef = useRef(localDateKey(now));
  const week = useMemo(() => localWeek(now), [localDateKey(now)]);
  const timezoneOffset = timezoneOffsetEast(now);
  const sourceScope = `${settings.aniwaveBaseUrl}|${(settings.disabledSources ?? []).includes("aniwave")}`;

  useEffect(() => setMode(settings.preferredMode), [settings.preferredMode]);
  useEffect(() => {
    const update = () => {
      const value = new Date(), today = localDateKey(value);
      setNow(value);
      if (today !== todayRef.current) { todayRef.current = today; setSelectedDate(today); }
    };
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);

  useEffect(() => {
    const id = catalogRequestId("schedule");
    let current = true;
    setLoading(true); setError(undefined);
    window.aniDesktop.schedule({ date: selectedDate, timezoneOffset, mode }, { id, priority: "selected", refresh: retry > 0, checkNow: retry > 0 })
      .then((value) => { if (current) setResult(value); }, (reason) => { if (current) setError(messageFrom(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; window.aniDesktop.cancelCatalog(id); };
  }, [selectedDate, timezoneOffset, mode, sourceScope, retry]);

  const rows = result?.requestedDate === selectedDate
    ? [...result.entries].sort((left, right) => left.releaseAt.localeCompare(right.releaseAt) || left.anime.title.localeCompare(right.anime.title))
    : [];
  const unavailable = result?.requestedDate === selectedDate && result.status === "unavailable";
  const displayError = error ?? result?.error;
  const zone = new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value;
  const rememberArtwork = useCallback((value: ScheduleArtwork) => setArtwork((current) => current[value.animeId] ? current : { ...current, [value.animeId]: value }), []);

  return <section className="section section-schedule" aria-labelledby="schedule-heading">
    <div className="section-head schedule-heading">
      <div><h2 id="schedule-heading">{seasonScheduleTitle(now)}</h2><span className="schedule-estimated">Estimated release times · {zone ?? "local time"}</span></div>
      <div className="chips-row" aria-label="Schedule audio">
        <span className="chips-lab">audio</span><span className="chips">
          {(["sub", "dub"] as const).map((value) => <button type="button" key={value} className={mode === value ? "on" : ""} aria-pressed={mode === value} onClick={() => setMode(value)}>{value.toUpperCase()}</button>)}
        </span>
      </div>
    </div>
    <div className="schedule-days" role="tablist" aria-label="Schedule day">
      {week.map((day) => <button type="button" role="tab" key={day.date} aria-selected={day.date === selectedDate}
        className={day.date === selectedDate ? "on" : ""} onClick={() => setSelectedDate(day.date)}>
        <b>{day.weekday}</b><span>{day.dateLabel}{day.today ? " · today" : ""}</span>
      </button>)}
    </div>
    <div className="schedule-list" aria-live="polite" aria-busy={loading}>
      {loading && rows.length === 0 && <div className="schedule-state">Loading schedule ···</div>}
      {!loading && (unavailable || (!displayError && rows.length === 0)) && <div className="schedule-state">Schedule unavailable for this date.</div>}
      {displayError && <div className="schedule-state schedule-error">
        <span>{result?.status === "stale" && rows.length ? `Showing saved schedule · ${displayError}` : displayError}</span>
        <button type="button" className="link" onClick={() => setRetry((value) => value + 1)}>Retry</button>
      </div>}
      {rows.map((entry: ScheduleEntry) => {
        const extra = artwork[entry.anime.id];
        const poster = entry.anime.poster ?? libraryPoster(entry.anime, library) ?? extra?.poster;
        const sources = animeSources(entry.anime).map((source) => ({ ...source, aliases: [...new Set([...source.aliases, ...(extra?.aliases ?? [])])], poster: source.poster ?? poster }));
        const anime = { ...entry.anime, title: entry.anime.title || extra?.title || "Untitled", poster, sources };
        const past = releaseHasPassed(entry.releaseAt, now);
        return <button type="button" className={`schedule-row ${past ? "past" : ""}`} key={`${entry.episode.id}:${entry.releaseAt}`}
          onClick={() => onOpen(anime, entry.episode, mode)} aria-label={`Open ${anime.title}, episode ${entry.episode.number}, ${new Date(entry.releaseAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}>
          <LazyScheduleArt animeId={anime.id} src={poster} onArtwork={rememberArtwork} />
          <span className="schedule-title">{anime.title}</span>
          <span className="schedule-episode">Episode {entry.episode.number}</span>
          <time dateTime={entry.releaseAt}>{new Date(entry.releaseAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </button>;
      })}
    </div>
  </section>;
}

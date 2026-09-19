import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BrowseAnime, BrowseFilters, BrowseResult, BrowseSort, MediaType } from "../shared/contracts";
import Art from "./Art";
import { catalogRequestId } from "./catalog-request";
import Chips from "./Chips";
import { messageFrom } from "./errors";
import GenreChips from "./GenreChips";
import { Icon } from "./icons";

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = { includeGenres: [], excludeGenres: [], sort: "popularity" };
export interface BrowseViewState {
  filters: BrowseFilters;
  /** Loaded pages in order; "Show more" appends the next one. */
  pages: BrowseResult[];
  panelOpen: boolean;
  scrollTop: number;
}
export const DEFAULT_BROWSE_STATE: BrowseViewState = { filters: DEFAULT_BROWSE_FILTERS, pages: [], panelOpen: false, scrollTop: 0 };

const TYPING_PAUSE = 400;
const SORTS: [BrowseSort, string][] = [["popularity", "Popular"], ["score", "Top rated"], ["newest", "Newest"], ["title", "A–Z"]];
const FORMATS = ["Any", "TV", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"] as const;
const FORMAT_NAMES = { MOVIE: "Movie", SPECIAL: "Special", MUSIC: "Music" } as const;
const STATUSES = ["Any", "ongoing", "finished", "upcoming"] as const;
const STATUS_NAMES = { ongoing: "Airing", finished: "Finished", upcoming: "Upcoming" } as const;
const SEASONS = ["Any", "winter", "spring", "summer", "fall"] as const;
const SEASON_NAMES = { winter: "Winter", spring: "Spring", summer: "Summer", fall: "Fall" } as const;

type Field = "year" | "minimumScore" | "minimumEpisodes" | "maximumEpisodes";
type Texts = Record<Field, string>;
const textsOf = (filters: BrowseFilters): Texts => ({
  year: String(filters.year ?? ""), minimumScore: filters.minimumScore === undefined ? "" : String(filters.minimumScore / 10),
  minimumEpisodes: String(filters.minimumEpisodes ?? ""), maximumEpisodes: String(filters.maximumEpisodes ?? "")
});
const wholeOf = (text: string): number | undefined => /^\d+$/.test(text.trim()) ? Number(text) : undefined;
/** Cards show scores out of ten; AniList filters on a hundred-point scale. */
const scoreOf = (text: string): number | undefined => /^\d{1,2}(?:\.\d)?$/.test(text.trim()) ? Math.round(Number(text) * 10) : undefined;
const valuesOf = (texts: Texts): Pick<BrowseFilters, Field> => ({ year: wholeOf(texts.year), minimumScore: scoreOf(texts.minimumScore), minimumEpisodes: wholeOf(texts.minimumEpisodes), maximumEpisodes: wholeOf(texts.maximumEpisodes) });
function problemsOf(texts: Texts): Partial<Record<Field, string>> {
  const problems: Partial<Record<Field, string>> = {}, values = valuesOf(texts);
  const outside = (name: Field, min: number, max: number) => texts[name].trim() !== "" && (values[name] === undefined || values[name] < min || values[name] > max);
  if (outside("year", 1900, 2200)) problems.year = "Enter a year from 1900 to 2200";
  if (outside("minimumScore", 1, 100)) problems.minimumScore = "Enter a score from 0.1 to 10";
  if (outside("minimumEpisodes", 1, 100_000)) problems.minimumEpisodes = "Enter a whole number";
  if (outside("maximumEpisodes", 1, 100_000)) problems.maximumEpisodes = "Enter a whole number";
  else if (!problems.minimumEpisodes && values.minimumEpisodes !== undefined && values.maximumEpisodes !== undefined && values.minimumEpisodes > values.maximumEpisodes) problems.maximumEpisodes = "Must be at least the starting count";
  return problems;
}

interface Token { key: string; label: string; remove: string; without: (filters: BrowseFilters) => BrowseFilters }
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
/** Every filter that narrows the results, each with the way to take it off. Genres come first because the empty state offers them first. */
function tokensOf(filters: BrowseFilters): { genres: Token[]; rest: Token[] } {
  const drop = (...names: (keyof BrowseFilters)[]) => (current: BrowseFilters) => { const next = { ...current }; for (const name of names) delete next[name]; return next; };
  const episodes = filters.minimumEpisodes !== undefined && filters.maximumEpisodes !== undefined ? `${filters.minimumEpisodes} to ${filters.maximumEpisodes} episodes`
    : filters.minimumEpisodes !== undefined ? `${filters.minimumEpisodes}+ episodes` : filters.maximumEpisodes !== undefined ? `Up to ${filters.maximumEpisodes} episodes` : undefined;
  const rest: (Token | undefined)[] = [
    filters.format && { key: "format", label: FORMAT_NAMES[filters.format as keyof typeof FORMAT_NAMES] ?? filters.format, without: drop("format") },
    filters.status && { key: "status", label: STATUS_NAMES[filters.status], without: drop("status") },
    filters.season && { key: "season", label: SEASON_NAMES[filters.season], without: drop("season") },
    filters.year !== undefined && { key: "year", label: String(filters.year), without: drop("year") },
    filters.minimumScore !== undefined && { key: "score", label: `Score ${filters.minimumScore / 10}+`, without: drop("minimumScore") },
    episodes !== undefined && { key: "episodes", label: episodes, without: drop("minimumEpisodes", "maximumEpisodes") }
  ].map((token) => token ? { ...token, remove: `Remove ${token.label}` } : undefined);
  return {
    genres: [
      ...filters.includeGenres.map((genre) => ({ key: `with-${genre}`, label: genre, remove: `Remove ${genre}`, without: (current: BrowseFilters) => ({ ...current, includeGenres: current.includeGenres.filter((value) => !same(value, genre)) }) })),
      ...filters.excludeGenres.map((genre) => ({ key: `without-${genre}`, label: `not ${genre}`, remove: `Allow ${genre}`, without: (current: BrowseFilters) => ({ ...current, excludeGenres: current.excludeGenres.filter((value) => !same(value, genre)) }) }))
    ],
    rest: rest.filter((token): token is Token => Boolean(token))
  };
}

const factsOf = (anime: BrowseAnime) => [anime.type ? FORMAT_NAMES[anime.type as keyof typeof FORMAT_NAMES] ?? anime.type : undefined, anime.year,
  anime.status === "ongoing" ? "airing" : anime.episodes && anime.episodes > 1 ? `${anime.episodes} eps` : undefined].filter(Boolean).join(" · ");

export default function BrowseScreen({ state, setState, enabled, openingId, onOpen }: {
  state: BrowseViewState; setState: Dispatch<SetStateAction<BrowseViewState>>; enabled: boolean;
  /** The title whose streaming sources are being checked; its card reports the check. */
  openingId?: number; onOpen: (anime: BrowseAnime) => void;
}) {
  const [genres, setGenres] = useState<string[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState<string>();
  const [genreError, setGenreError] = useState<string>(), [genreAttempt, setGenreAttempt] = useState(0);
  const [texts, setTexts] = useState(() => textsOf(state.filters));
  const request = useRef<string | undefined>(undefined), sequence = useRef(0);
  // The last titles on screen stay, dimmed, while a changed filter loads its first page.
  const held = useRef<BrowseAnime[]>([]);
  const { filters, pages } = state, problems = problemsOf(texts);
  const load = (page: number, refresh = false) => {
    if (!enabled) return;
    const token = ++sequence.current;
    if (request.current) window.aniDesktop.cancelCatalog(request.current);
    const id = catalogRequestId("browse"); request.current = id; setLoading(true); setError(undefined);
    void window.aniDesktop.browse({ filters, page }, { id, priority: "visible", refresh }).then((result) => {
      if (token !== sequence.current) return;
      setState((previous) => previous.filters === filters ? { ...previous, pages: Object.assign([...previous.pages], { [page - 1]: result }) } : previous);
    }, (reason) => { if (token === sequence.current) setError(messageFrom(reason)); })
      .finally(() => { if (token === sequence.current) { setLoading(false); request.current = undefined; } });
  };
  useEffect(() => {
    if (!enabled) return;
    const id = catalogRequestId("browse-genres"); let current = true; setGenreError(undefined);
    void window.aniDesktop.browseGenres({ id, priority: "visible", refresh: genreAttempt > 0 }).then((values) => { if (current) setGenres(values); }, (reason) => { if (current) setGenreError(messageFrom(reason)); });
    return () => { current = false; window.aniDesktop.cancelCatalog(id); };
  }, [enabled, genreAttempt]);
  useEffect(() => { if (enabled && !pages.length) load(1); }, [enabled, filters]);
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".page-browse");
    if (page) page.scrollTop = state.scrollTop;
    return () => {
      sequence.current += 1;
      if (request.current) window.aniDesktop.cancelCatalog(request.current);
      if (page) setState((previous) => ({ ...previous, scrollTop: page.scrollTop }));
    };
  }, []);
  // Every change applies at once and starts again from the first page.
  const apply = (change: (filters: BrowseFilters) => BrowseFilters) => setState((previous) => ({ ...previous, filters: change(previous.filters), pages: [] }));
  const set = <K extends keyof BrowseFilters>(key: K, value: BrowseFilters[K] | undefined) => apply((current) => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; });
  // Typed fields wait for a pause, and an invalid entry is held back until it is fixed.
  useEffect(() => {
    if (Object.keys(problemsOf(texts)).length) return;
    const values = valuesOf(texts), names = Object.keys(values) as Field[];
    if (names.every((name) => values[name] === filters[name])) return;
    const timer = window.setTimeout(() => apply((current) => { const next = { ...current }; for (const name of names) { if (values[name] === undefined) delete next[name]; else next[name] = values[name]; } return next; }), TYPING_PAUSE);
    return () => window.clearTimeout(timer);
  }, [texts]);
  const remove = (token: Token) => { const next = token.without(filters); setTexts(textsOf(next)); apply(() => next); };
  const clear = () => { setTexts(textsOf(DEFAULT_BROWSE_FILTERS)); apply((current) => ({ ...DEFAULT_BROWSE_FILTERS, sort: current.sort })); };
  // One click includes a genre, the next excludes it, the third lets it go.
  const cycleGenre = (genre: string) => apply((current) => {
    const included = current.includeGenres.some((value) => same(value, genre)), excluded = current.excludeGenres.some((value) => same(value, genre));
    const includeGenres = current.includeGenres.filter((value) => !same(value, genre)), excludeGenres = current.excludeGenres.filter((value) => !same(value, genre));
    return { ...current, includeGenres: included || excluded ? includeGenres : [...includeGenres, genre], excludeGenres: included ? [...excludeGenres, genre] : excludeGenres };
  });
  const genreState = (genre: string) => filters.includeGenres.some((value) => same(value, genre)) ? "inc" : filters.excludeGenres.some((value) => same(value, genre)) ? "exc" : "";

  const seen = new Set<number>(), entries = pages.flatMap((page) => page.entries).filter((anime) => !seen.has(anime.anilistId) && seen.add(anime.anilistId));
  if (entries.length) held.current = entries;
  const last = pages.at(-1), stale = pages.find((page) => page.stale), tokens = tokensOf(filters);
  const waiting = loading && !pages.length, shown = waiting ? held.current : entries;
  const input = (name: Field, label: string, wide = false, spoken?: string) => <label className="browse-field"><span className="chips-lab">{label}</span>
    <input type="text" inputMode={name === "minimumScore" ? "decimal" : "numeric"} maxLength={name === "year" || name === "minimumScore" ? 4 : 6} className={wide ? "wide" : ""} value={texts[name]} placeholder="Any" aria-label={spoken}
      onChange={(event) => setTexts((previous) => ({ ...previous, [name]: event.target.value }))} {...(problems[name] ? { "aria-invalid": true, "aria-describedby": `browse-${name}-problem` } as const : {})} /></label>;

  return <section className="section browse" aria-labelledby="browse-heading">
    <div className="section-head"><h2 id="browse-heading">Browse</h2><span className="browse-sub">AniList catalog</span>
      {enabled && <div className="browse-sort" role="radiogroup" aria-label="Sort">{SORTS.map(([value, name]) => <button type="button" key={value} role="radio" aria-checked={filters.sort === value} className={filters.sort === value ? "on" : ""} onClick={() => filters.sort !== value && set("sort", value)}>{name}</button>)}</div>}</div>
    {!enabled ? <div className="empty"><b>Anime information is disabled</b>Enable it in Settings to browse the AniList catalog.</div> : <>
      {genres.length > 0 && <div className="browse-genres" role="group" aria-label="Genres">{genres.map((genre) => { const mark = genreState(genre); return <button type="button" key={genre} className={`genre ${mark}`}
        aria-pressed={mark === "inc" ? true : mark === "exc" ? "mixed" : false} title={mark === "inc" ? "Included · click to exclude" : mark === "exc" ? "Excluded · click to clear" : "Click to include"} onClick={() => cycleGenre(genre)}>{genre}{mark === "exc" && <span className="sr-only"> excluded</span>}</button>; })}</div>}
      {genreError && <div className="notice">Genres could not load. {genreError} <button type="button" className="link" onClick={() => setGenreAttempt((value) => value + 1)}>Retry</button></div>}
      <div className="browse-line"><button type="button" className={`browse-toggle ${state.panelOpen ? "open" : ""}`} aria-expanded={state.panelOpen} aria-controls="browse-panel" onClick={() => setState((previous) => ({ ...previous, panelOpen: !previous.panelOpen }))}>Filters<Icon name="chevron" /></button>
        {tokens.rest.map((token) => <span className="token" key={token.key}>{token.label}<button type="button" aria-label={token.remove} onClick={() => remove(token)}>×</button></span>)}
        {(tokens.rest.length > 0 || tokens.genres.length > 0) && <button type="button" className="browse-clear" onClick={clear}>Clear all</button>}</div>
      {state.panelOpen && <div className="browse-panel" id="browse-panel">
        <Chips label="Format" value={filters.format ?? "Any"} options={FORMATS} names={FORMAT_NAMES} onChange={(value) => set("format", value === "Any" ? undefined : value as MediaType)} />
        <Chips label="Status" value={filters.status ?? "Any"} options={STATUSES} names={STATUS_NAMES} onChange={(value) => set("status", value === "Any" ? undefined : value)} />
        <Chips label="Season" value={filters.season ?? "Any"} options={SEASONS} names={SEASON_NAMES} onChange={(value) => set("season", value === "Any" ? undefined : value)} />
        {input("year", "Year", true)}{input("minimumScore", "Score from")}
        <span className="browse-range">{input("minimumEpisodes", "Episodes", false, "Episodes from")}{input("maximumEpisodes", "to", false, "Episodes to")}</span>
        {(Object.keys(problems) as Field[]).map((name) => <small className="field-problem" id={`browse-${name}-problem`} key={name}>{problems[name]}</small>)}
      </div>}
      {stale && <div className="notice">Showing cached results. {stale.error} <button type="button" className="link" onClick={() => load(stale.query.page, true)}>Retry</button></div>}
      {error && <div className="msg err" role="alert">{error} <button type="button" className="link" onClick={() => load(pages.length + 1, true)}>Retry</button></div>}
      {shown.length > 0 && <div className={`cards browse-grid ${waiting ? "is-loading" : ""} ${openingId !== undefined ? "is-opening" : ""}`} aria-busy={loading}>{shown.map((anime) => { const opening = anime.anilistId === openingId; return <div className={`card ${opening ? "is-resolving" : ""}`} key={anime.anilistId}>
        <button type="button" className="hit" aria-busy={opening} title={opening ? "Checking streaming sources · click to cancel" : undefined} onClick={() => onOpen(anime)}><Art src={anime.cover} className="poster" />
          {anime.score !== undefined && anime.score > 0 && <span className="badges top"><span className="badge">{(anime.score / 10).toFixed(1)}</span></span>}
          {opening && <span className="badges"><span className="badge hi" role="status">checking<span className="dots"> ···</span></span></span>}</button>
        <span className="t">{anime.title}</span><span className="s">{factsOf(anime)}</span><GenreChips genres={anime.genres} /></div>; })}</div>}
      {loading && (pages.length > 0 || !shown.length) && <div className="browse-ghosts" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <span className="ghost" key={index} />)}</div>}
      {!loading && !error && last && !entries.length && (last.hasNextPage
        ? <div className="browse-none"><b>No matches so far</b>The first {pages.length === 1 ? "page" : `${pages.length} pages`} had nothing to show. More of the catalog may match.</div>
        : <div className="browse-none"><b>Nothing matches all of these</b>{filters.includeGenres.length > 1 ? "Included genres must all be present on a title. Try dropping one." : "Try taking a filter off."}
          <div className="fixes">{[...tokens.genres, ...tokens.rest].map((token) => <button type="button" className="btn small" key={token.key} onClick={() => remove(token)}>{token.remove}</button>)}
            {tokens.genres.length + tokens.rest.length > 1 && <button type="button" className="btn small" onClick={clear}>Clear all</button>}</div></div>)}
      {last && !waiting && <div className="browse-more">{loading ? <span role="status">{entries.length} shown · loading more<span className="dots"> ···</span></span>
        : <>{entries.length > 0 && <span>{last.hasNextPage ? `${entries.length} shown` : `All ${entries.length} shown`}</span>}{last.hasNextPage && !error && <button type="button" className="btn small" onClick={() => load(pages.length + 1)}>Show more</button>}</>}</div>}
    </>}
  </section>;
}

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BrowseAnime, BrowseFilters, BrowseResult, MediaType, WorkStatus } from "../shared/contracts";
import Art from "./Art";
import { catalogRequestId } from "./catalog-request";
import { messageFrom } from "./errors";

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = { includeGenres: [], excludeGenres: [], sort: "popularity" };
export interface BrowseViewState {
  draft: BrowseFilters;
  applied: BrowseFilters;
  page: number;
  visited: number[];
  result?: BrowseResult;
  scrollTop: number;
}
export const DEFAULT_BROWSE_STATE: BrowseViewState = { draft: DEFAULT_BROWSE_FILTERS, applied: DEFAULT_BROWSE_FILTERS, page: 1, visited: [1], scrollTop: 0 };

const number = (value: string): number | undefined => value ? Number(value) : undefined;
const selected = (event: React.ChangeEvent<HTMLSelectElement>) => [...event.currentTarget.selectedOptions].map((option) => option.value);

export default function BrowseScreen({ state, setState, enabled, onOpen }: {
  state: BrowseViewState; setState: Dispatch<SetStateAction<BrowseViewState>>; enabled: boolean; onOpen: (anime: BrowseAnime) => void;
}) {
  const [genres, setGenres] = useState<string[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState<string>();
  const request = useRef<string | undefined>(undefined), sequence = useRef(0);
  const load = (page = state.page, refresh = false) => {
    if (!enabled) return;
    const token = ++sequence.current;
    if (request.current) window.aniDesktop.cancelCatalog(request.current);
    const id = catalogRequestId("browse"); request.current = id; setLoading(true); setError(undefined);
    const query = { filters: state.applied, page };
    void window.aniDesktop.browse(query, { id, priority: "visible", refresh }).then((result) => {
      if (token !== sequence.current) return;
      setState((previous) => ({ ...previous, page, result, visited: [...new Set([...previous.visited, page])].sort((a, b) => a - b) }));
    }, (reason) => { if (token === sequence.current) setError(messageFrom(reason)); })
      .finally(() => { if (token === sequence.current) { setLoading(false); request.current = undefined; } });
  };
  useEffect(() => {
    if (!enabled) return;
    const id = catalogRequestId("browse-genres");
    void window.aniDesktop.browseGenres({ id, priority: "visible" }).then(setGenres, (reason) => setError(messageFrom(reason)));
    return () => window.aniDesktop.cancelCatalog(id);
  }, [enabled]);
  useEffect(() => { if (enabled && (!state.result || JSON.stringify(state.result.query) !== JSON.stringify({ filters: state.applied, page: state.page }))) load(); }, [enabled, state.applied, state.page]);
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".page-browse");
    if (page) page.scrollTop = state.scrollTop;
    return () => {
      if (request.current) window.aniDesktop.cancelCatalog(request.current);
      if (page) setState((previous) => ({ ...previous, scrollTop: page.scrollTop }));
    };
  }, []);
  const update = <K extends keyof BrowseFilters>(key: K, value: BrowseFilters[K]) => setState((previous) => ({ ...previous, draft: { ...previous.draft, [key]: value } }));
  const apply = () => setState((previous) => ({ ...previous, applied: { ...previous.draft }, page: 1, visited: [1], result: undefined }));
  const reset = () => setState((previous) => ({ ...previous, draft: { ...DEFAULT_BROWSE_FILTERS }, applied: { ...DEFAULT_BROWSE_FILTERS }, page: 1, visited: [1], result: undefined }));
  const changeGenres = (kind: "includeGenres" | "excludeGenres", values: string[]) => {
    const other = kind === "includeGenres" ? "excludeGenres" : "includeGenres";
    setState((previous) => ({ ...previous, draft: { ...previous.draft, [kind]: values,
      [other]: previous.draft[other].filter((genre) => !values.some((value) => value.toLocaleLowerCase() === genre.toLocaleLowerCase())) } }));
  };
  return <section className="browse" aria-labelledby="browse-heading">
    <div className="browse-heading"><div><h1 id="browse-heading">Browse anime</h1><p>Explore AniList in small pages. Streaming sources are checked only after you open a title.</p></div></div>
    {!enabled ? <div className="empty"><b>Anime information is disabled</b>Enable it in Settings to browse the AniList catalog.</div> : <>
      <div className="browse-filters">
        <label>Include all genres<select multiple value={state.draft.includeGenres} onChange={(event) => changeGenres("includeGenres", selected(event))}>{genres.map((genre) => <option key={genre}>{genre}</option>)}</select></label>
        <label>Exclude genres<select multiple value={state.draft.excludeGenres} onChange={(event) => changeGenres("excludeGenres", selected(event))}>{genres.map((genre) => <option key={genre}>{genre}</option>)}</select></label>
        <label>Year<input type="number" min="1900" max="2200" value={state.draft.year ?? ""} onChange={(event) => update("year", number(event.target.value))} placeholder="Any" /></label>
        <label>Season<select value={state.draft.season ?? ""} onChange={(event) => update("season", event.target.value as BrowseFilters["season"] || undefined)}><option value="">Any</option><option value="winter">Winter</option><option value="spring">Spring</option><option value="summer">Summer</option><option value="fall">Fall</option></select></label>
        <label>Status<select value={state.draft.status ?? ""} onChange={(event) => update("status", event.target.value as Exclude<WorkStatus, "unknown"> || undefined)}><option value="">Any</option><option value="ongoing">Airing</option><option value="finished">Finished</option><option value="upcoming">Upcoming</option></select></label>
        <label>Format<select value={state.draft.format ?? ""} onChange={(event) => update("format", event.target.value as MediaType || undefined)}><option value="">Any</option>{["TV", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Minimum score<input type="number" min="1" max="100" value={state.draft.minimumScore ?? ""} onChange={(event) => update("minimumScore", number(event.target.value))} placeholder="1–100" /></label>
        <label>Episodes from<input type="number" min="1" value={state.draft.minimumEpisodes ?? ""} onChange={(event) => update("minimumEpisodes", number(event.target.value))} placeholder="Any" /></label>
        <label>Episodes to<input type="number" min="1" value={state.draft.maximumEpisodes ?? ""} onChange={(event) => update("maximumEpisodes", number(event.target.value))} placeholder="Any" /></label>
        <label>Sort<select value={state.draft.sort} onChange={(event) => update("sort", event.target.value as BrowseFilters["sort"])}><option value="popularity">Popularity</option><option value="score">Score</option><option value="newest">Newest release</option><option value="title">Title</option></select></label>
        <div className="browse-filter-actions"><button type="button" className="btn" onClick={reset}>Reset</button><button type="button" className="btn primary" onClick={apply}>Apply filters</button></div>
      </div>
      {state.result?.stale && <div className="notice">Showing cached results. {state.result.error}<button type="button" className="link" onClick={() => load(state.page, true)}>Retry</button></div>}
      {error && <div className="msg err" role="alert">{error} <button type="button" className="link" onClick={() => load(state.page, true)}>Retry</button></div>}
      {loading && !state.result ? <div className="browse-state">Loading page {state.page}<span className="dots"> ···</span></div>
        : state.result && !state.result.entries.length ? <div className="empty"><b>No anime match these filters</b>Try removing a genre or widening the score and episode ranges.</div>
        : <div className="browse-grid">{state.result?.entries.map((anime) => <article className="browse-card" key={anime.anilistId}><button type="button" onClick={() => onOpen(anime)}>
          <Art src={anime.cover} className="poster" /><strong>{anime.title}</strong><span>{[anime.type, anime.year, anime.score ? `${(anime.score / 10).toFixed(1)} score` : undefined].filter(Boolean).join(" · ")}</span><small>{anime.genres.slice(0, 3).join(" · ")}</small>
        </button></article>)}</div>}
      <nav className="browse-pages" aria-label="Browse pages"><button type="button" className="btn small" disabled={loading || state.page === 1} onClick={() => load(state.page - 1)}>Previous</button>
        {state.visited.map((page) => <button type="button" key={page} className={page === state.page ? "on" : ""} aria-current={page === state.page ? "page" : undefined} onClick={() => load(page)}>{page}</button>)}
        <button type="button" className="btn small" disabled={loading || !state.result?.hasNextPage} onClick={() => load(state.page + 1)}>Next</button><span>Page {state.page}</span></nav>
    </>}
  </section>;
}

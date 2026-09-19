import type { BrowseAnime } from "../shared/contracts";
import Art from "./Art";
import { Icon } from "./icons";

export default function BrowseDetail({ anime, resolving, error, onBack, onRetry }: { anime: BrowseAnime; resolving: boolean; error?: string; onBack: () => void; onRetry: () => void }) {
  return <div className="series browse-detail">
    <aside className="side"><Art src={anime.cover} className="poster" /><div className="genre-bubbles">{anime.genres.map((genre) => <span key={genre}>{genre}</span>)}</div></aside>
    <main className="main"><button type="button" className="crumb" onClick={onBack}><Icon name="back" />Browse</button><h1>{anime.title}</h1>
      <div className="meta"><span className="tag quiet">AniList catalog</span>{resolving && <span className="tag quiet">checking streaming sources<span className="dots"> ···</span></span>}</div>
      <div className="facts"><div><small>Format</small>{anime.type ?? "Unknown"}</div><div><small>Year</small>{anime.year ?? "Unknown"}</div><div><small>Status</small>{anime.status}</div><div><small>Announced total</small>{anime.episodes ?? "Unknown"}</div>{anime.score && <div><small>Score</small>{(anime.score / 10).toFixed(1)}</div>}</div>
      {anime.description && <section className="about"><p className="synopsis open">{anime.description}</p></section>}
      {!resolving && <div className={error ? "msg err" : "notice"}>{error ?? "No matching source found."} <button type="button" className="link" onClick={onRetry}>Retry source search</button></div>}
    </main>
  </div>;
}

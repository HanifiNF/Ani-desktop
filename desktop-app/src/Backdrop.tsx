import type { BackdropArt } from "../shared/contracts";
import { BACKDROP_CREDIT_URL } from "../shared/backdrops";

/** How an illustration sits behind a page: a wash across the top, or a figure peeking from the top-right corner. */
export type BackdropVariant = "wash" | "corner";
export type BackdropPage = "home" | "saved" | "recent";

/** The illustration itself, placed behind the bar and the page by the app shell. */
export function Backdrop({ art, variant }: { art: BackdropArt; variant: BackdropVariant }) {
  return <div className={`backdrop backdrop-${variant}${art.light ? " is-light" : ""}`} aria-hidden="true"><img src={art.src} alt="" /></div>;
}

/** Where the art came from, with its artist and source when known; sits at the end of the footer's foot line. */
export function BackdropCredit({ art }: { art: BackdropArt }) {
  return <span className="backdrop-credit">art via <a href={BACKDROP_CREDIT_URL} target="_blank" rel="noreferrer noopener">nekosapi.com</a>
    {art.artist && <> · {art.artist}</>}
    {art.sourceUrl && <> · <a href={art.sourceUrl} target="_blank" rel="noreferrer noopener">source</a></>}</span>;
}

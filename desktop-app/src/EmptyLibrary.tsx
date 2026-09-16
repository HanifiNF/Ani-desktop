import { Icon } from "./icons";

export type EmptyKind = "home" | "saved" | "recent";

const GHOSTS = 7;
const COPY: Record<EmptyKind, { heading: string; icon: "search" | "bookmark" | "play"; action: string; title: string; note: string }> = {
  home: { heading: "Continue watching", icon: "search", action: "Search anime", title: "Nothing here yet", note: "Titles you watch and save appear here." },
  saved: { heading: "Saved", icon: "bookmark", action: "Save a series", title: "Nothing saved yet", note: "Open a series and choose Save. Saved titles keep their place here." },
  recent: { heading: "Recent", icon: "play", action: "Play something", title: "Nothing watched yet", note: "Every episode you open is listed here." }
};

/** An empty library keeps the shape of a full one: the section head, an action tile, and a row of ghost posters fading out. */
export default function EmptyLibrary({ kind, onAction }: { kind: EmptyKind; onAction: () => void }) {
  const copy = COPY[kind];
  return <section className={`section section-empty section-empty-${kind}`} aria-labelledby={`${kind}-heading`}>
    <div className="section-head"><h2 id={`${kind}-heading`}>{copy.heading}</h2><span className="count">nothing yet</span></div>
    <div className="ghosts" aria-hidden={false}>
      <button type="button" className={`start-tile${kind === "home" ? " on" : ""}`} onClick={onAction}><Icon name={copy.icon} /><span>{copy.action}</span></button>
      {Array.from({ length: GHOSTS }, (_, index) => <div key={index} className="ghost" aria-hidden="true" />)}
    </div>
    {kind !== "home" && <p className="ghost-note"><b>{copy.title}</b>{copy.note}</p>}
  </section>;
}


import { useState, type ReactNode } from "react";
import { CREATORS, type Creator } from "./creators";
import { Icon } from "./icons";

export type SitePage = "home" | "about" | "contact";

interface FooterProps {
  current: SitePage | undefined;
  onNavigate: (page: SitePage) => void;
}

export function SiteFooter({ current, onNavigate }: FooterProps) {
  return <footer className="site-footer">
    <button type="button" className="logo footer-logo" onClick={() => onNavigate("home")} aria-label="ANIdesktop home">ANI<em>desktop</em></button>
    <nav aria-label="Information">
      {(["home", "about", "contact"] as const).map((page) => <button key={page} type="button"
        aria-current={current === page ? "page" : undefined} onClick={() => onNavigate(page)}>{page[0].toUpperCase() + page.slice(1)}</button>)}
    </nav>
  </footer>;
}

export function AboutPage() {
  return <main className="info-page about-page">
    <p className="eyebrow">About</p>
    <h1>Anime, all in one desktop app.</h1>
    <p className="lead">ANIdesktop is a cross-platform way to browse and watch anime through a unified catalog, without losing track of what comes next.</p>
    <div className="about-grid">
      <section><h2>Built for watching</h2><p>Search across supported providers, browse seasonal schedules, save titles, revisit recent episodes, and play them in the built-in media player.</p></section>
      <section><h2>Made together</h2><p>ANIdesktop is created and maintained by <strong>Hanifi</strong> and <strong>Pascal</strong>.</p></section>
      <section className="thanks-card">
        <h2>A huge thank you to ani-cli</h2>
        <p>ani-cli is the main reference that inspired ANIdesktop. Its simple, capable approach to finding anime and opening episodes in a media player helped shape the foundation of this app. We are deeply grateful to the ani-cli maintainers and contributors for building and sharing the project that gave us a place to begin.</p>
        <External href="https://github.com/pystardust/ani-cli">Visit ani-cli on GitHub</External>
      </section>
    </div>
    <p className="legal-note">ANIdesktop does not host streamed media. Titles and playback availability depend on their respective providers.</p>
  </main>;
}

function CreatorPortrait({ creator }: { creator: Creator }) {
  const [failed, setFailed] = useState(false);
  return <div className="creator-portrait">
    {!failed && <img src={creator.photo} alt={`${creator.name} portrait`} onError={() => setFailed(true)} />}
    {failed && <span aria-label={`${creator.name} portrait placeholder`}>{creator.initials}</span>}
  </div>;
}

const External = ({ href, children }: { href: string; children: ReactNode }) =>
  <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;

export function ContactPage() {
  return <main className="info-page contact-page">
    <p className="eyebrow">Contact</p>
    <h1>Meet the people behind ANIdesktop.</h1>
    <p className="lead">For project questions, ideas, or collaboration, reach out to either creator through the channels below.</p>
    <div className="creator-grid">
      {CREATORS.map((creator) => <article className="creator-card" key={creator.name}>
        <CreatorPortrait creator={creator} />
        <div className="creator-details">
          <h2>{creator.name}</h2>
          <dl>
            <div><dt>GitHub</dt><dd><External href={creator.github.url}><span className="contact-value"><Icon name="github" />{creator.github.handle}</span></External></dd></div>
            <div><dt>Discord</dt><dd><span className="contact-value selectable"><Icon name="discord" />{creator.discord}</span></dd></div>
            <div><dt>Instagram</dt><dd><External href={creator.instagram.url}><span className="contact-value"><Icon name="instagram" />{creator.instagram.handle}</span></External></dd></div>
            {creator.email && <div><dt>Email</dt><dd><External href={`mailto:${creator.email}`}><span className="contact-value"><Icon name="mail" />{creator.email}</span></External></dd></div>}
          </dl>
        </div>
      </article>)}
    </div>
  </main>;
}

import { useEffect, useState, type ReactNode } from "react";
import { CREATORS, type Creator } from "./creators";
import { Icon } from "./icons";

export type FooterScreen = "home" | "saved" | "recent" | "settings";

export const ANI_CLI_URL = "https://github.com/pystardust/ani-cli";
export const ANI_CLI_AUTHOR_URL = "https://github.com/pystardust";
export const SOURCE_URL = "https://github.com/HanifiNF/Ani-cli-aniwave";

const APP_LINKS: readonly { screen: FooterScreen; label: string; icon: "home" | "bookmark" | "clock" | "gear" }[] = [
  { screen: "home", label: "Home", icon: "home" },
  { screen: "saved", label: "Saved", icon: "bookmark" },
  { screen: "recent", label: "Recent", icon: "clock" },
  { screen: "settings", label: "Settings", icon: "gear" }
];

interface FooterProps {
  current: FooterScreen | undefined;
  onNavigate: (screen: FooterScreen) => void;
}

/** The footer holds the about text, the app links, and the creators, so there are no separate information pages. */
export function SiteFooter({ current, onNavigate }: FooterProps) {
  return <footer className="site-footer">
    <div className="footer-columns">
      <div className="footer-about">
        <button type="button" className="logo footer-logo" onClick={() => onNavigate("home")} aria-label="ANIdesktop home">ANI<em>desktop</em></button>
        <p>Browse and watch anime from several providers in one place, and keep track of what comes next.</p>
        <p className="footer-credit">Built on <External href={ANI_CLI_URL}>ani-cli</External> by <External href={ANI_CLI_AUTHOR_URL}>pystardust</External> and its contributors, whose work is the foundation of this app.</p>
        <p>Source on <External href={SOURCE_URL}>GitHub</External>.</p>
      </div>
      <nav className="footer-group" aria-label="App">
        <h4>App</h4>
        {APP_LINKS.map(({ screen, label, icon }) => <button key={screen} type="button" className="footer-link"
          aria-current={current === screen ? "page" : undefined} onClick={() => onNavigate(screen)}><Icon name={icon} />{label}</button>)}
      </nav>
      <div className="footer-group">
        <h4>Made by</h4>
        {CREATORS.map((creator) => <CreatorRow creator={creator} key={creator.name} />)}
      </div>
    </div>
    <div className="footer-foot">
      <span>ANIdesktop does not host streamed media. Titles and playback availability depend on their providers.</span>
    </div>
  </footer>;
}

function CreatorRow({ creator }: { creator: Creator }) {
  return <div className="creator">
    <CreatorPortrait creator={creator} />
    <div>
      <b>{creator.name}</b>
      <div className="creator-socials">
        <External href={creator.github.url} title={`GitHub · ${creator.github.handle}`}><Icon name="github" /><span className="sr-only">GitHub {creator.github.handle}</span></External>
        <CopyHandle label="Discord" value={creator.discord} />
        <External href={creator.instagram.url} title={`Instagram · ${creator.instagram.handle}`}><Icon name="instagram" /><span className="sr-only">Instagram {creator.instagram.handle}</span></External>
        {creator.email && <External href={`mailto:${creator.email}`} title={creator.email}><Icon name="mail" /><span className="sr-only">Email {creator.email}</span></External>}
      </div>
    </div>
  </div>;
}

function CreatorPortrait({ creator }: { creator: Creator }) {
  const [failed, setFailed] = useState(false);
  return <div className="creator-portrait">
    {!failed && <img src={creator.photo} alt={`${creator.name} portrait`} onError={() => setFailed(true)} />}
    {failed && <span aria-label={`${creator.name} portrait placeholder`}>{creator.initials}</span>}
  </div>;
}

/** Discord has no profile address, so the icon copies the handle instead. */
function CopyHandle({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return <button type="button" className={copied ? "copied" : undefined} title={`${label} · ${value} (click to copy)`}
    onClick={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined); }}>
    <Icon name="discord" /><span className="sr-only">{label} {value}</span>
    {copied && <span className="copied-tip" role="status">Copied</span>}
  </button>;
}

function External({ href, title, children }: { href: string; title?: string; children: ReactNode }) {
  return <a href={href} title={title} target="_blank" rel="noreferrer noopener">{children}</a>;
}

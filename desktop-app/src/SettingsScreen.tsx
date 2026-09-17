import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ProviderPreference, Settings, SubtitleAppearance, UpdateStatus } from "../shared/contracts";
import { enabledProviders } from "../shared/catalog";
import { PLAYBACK_QUALITIES as QUALITIES } from "../shared/settings";
import { THEME_NAMES, resolveTheme } from "../shared/theme";
import Chips from "./Chips";
import Switch from "./Switch";
import { isMac } from "./keys";
import SourceStatusPanel from "./SourceStatusPanel";
import BookmarkMetadataPanel from "./BookmarkMetadataPanel";
import IdentityIndexPanel from "./IdentityIndexPanel";
import { UpdatePanel } from "./UpdateUI";
import { SubtitleAppearanceEditor } from "./SubtitleAppearanceEditor";

interface Props {
  draft: Settings; setDraft: Dispatch<SetStateAction<Settings>>; saved: Settings;
  bookmarkCount: number; linkCount: number; dirty: boolean;
  onSave: () => void; onCancel: () => void; onOpenLogs: () => void; onClearLinks: () => void;
  updateStatus?: UpdateStatus; updateChecking: boolean; onCheckUpdates: () => void; onOpenUpdate: () => void;
  subtitleAppearance: SubtitleAppearance; onSubtitleAppearance: (value: SubtitleAppearance) => void;
}

const sections = [
  { id: "settings-updates", label: "Updates" },
  { id: "settings-playback", label: "Playback" },
  { id: "settings-subtitles", label: "Subtitles" },
  { id: "settings-defaults", label: "Defaults" },
  { id: "settings-appearance", label: "Appearance" },
  { id: "settings-anime-information", label: "Anime information" },
  { id: "settings-episode-metadata", label: "Episode metadata" },
  { id: "settings-sources", label: "Sources" }
] as const;

function useSectionNavigation() {
  const formRef = useRef<HTMLFormElement>(null);
  const [active, setActive] = useState<string>(sections[0].id);
  useEffect(() => {
    const page = formRef.current?.closest<HTMLElement>(".page-settings");
    if (!page) return;
    const headings = sections.map(({ id }) => document.getElementById(id)).filter((node): node is HTMLElement => node instanceof HTMLElement);
    const update = () => {
      const line = page.getBoundingClientRect().top + 76;
      let current: string = sections[0].id;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= line) current = heading.id;
      }
      setActive(current);
    };
    page.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(page);
    headings.forEach((heading) => observer?.observe(heading.parentElement ?? heading));
    update();
    return () => {
      page.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, []);
  const jump = (id: string) => {
    const page = formRef.current?.closest<HTMLElement>(".page-settings");
    const heading = document.getElementById(id);
    if (!page || !heading || !sections.some((section) => section.id === id)) return;
    const offset = page.querySelector(".settings-jump")?.getBoundingClientRect().height || 0;
    const top = page.scrollTop + heading.getBoundingClientRect().top - page.getBoundingClientRect().top - offset - 16;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setActive(id);
    heading.focus({ preventScroll: true });
    page.scrollTo({ top, behavior: reducedMotion ? "instant" : "smooth" });
  };
  return { formRef, active, jump };
}

export default function SettingsScreen({ draft, setDraft, saved, bookmarkCount, linkCount, dirty, onSave, onCancel, onOpenLogs, onClearLinks,
  updateStatus, updateChecking, onCheckUpdates, onOpenUpdate, subtitleAppearance, onSubtitleAppearance }: Props) {
  const { formRef, active, jump } = useSectionNavigation();
  return (
    <div className="settings-layout">
    <h1>Settings</h1>
    <form ref={formRef} className="settings" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="settings-jump"><label htmlFor="settings-section-jump">Jump to section</label><select id="settings-section-jump" value={active} onChange={(event) => jump(event.target.value)}>{sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}</select></div>
      <UpdatePanel status={updateStatus} checking={updateChecking} onCheck={onCheckUpdates} onOpen={onOpenUpdate} />
      <div className="group"><h3 id="settings-playback" tabIndex={-1}>Playback</h3><div className="box">
        <div className="r"><span className="k">Player<small>Built-in works without installing another player</small></span><Chips value={draft.playbackTarget} options={["builtin", "external"] as const} onChange={(playbackTarget) => setDraft({ ...draft, playbackTarget })} names={{ builtin: "built-in" }} /></div>
        <div className="r"><span className="k">Start fullscreen<small>Enter fullscreen as soon as an episode starts</small></span><Switch checked={draft.startPlayerFullscreen} label="Start fullscreen" onChange={(startPlayerFullscreen) => setDraft({ ...draft, startPlayerFullscreen })} /></div>
        <div className="r"><span className="k">Autoplay next episode<small>Built-in player only. Waits five seconds and can be cancelled</small></span><Switch checked={draft.autoplayNext !== false} label="Autoplay next episode" onChange={(autoplayNext) => setDraft({ ...draft, autoplayNext })} /></div>
        <div className="r"><span className="k">Diagnostics<small>Local keyboard and playback logs for troubleshooting</small></span><span className="v-row"><button type="button" className="btn small" onClick={() => { onOpenLogs(); }}>open logs</button><Switch checked={draft.playerDiagnostics === true} label="Diagnostics logging" onChange={(playerDiagnostics) => setDraft({ ...draft, playerDiagnostics })} /></span></div>
        <div className="r"><label htmlFor="player" className="k">External player<small>Optional with the built-in player. {isMac() ? "mpv, VLC, or IINA's iina-cli" : "mpv or VLC, by name or full path"}</small></label><input id="player" value={draft.playerPath} placeholder={draft.playbackTarget === "external" ? (isMac() ? "iina-cli" : "mpv") : "optional"} spellCheck={false} onChange={(event) => setDraft({ ...draft, playerPath: event.target.value })} /></div>
      </div></div>
      <div className="group"><h3 id="settings-subtitles" tabIndex={-1}>Subtitles</h3><div className="box subtitle-settings-box">
        <p className="subtitle-help">Appearance changes save automatically for the built-in player.</p>
        <SubtitleAppearanceEditor value={subtitleAppearance} onChange={onSubtitleAppearance} />
      </div></div>
      <div className="group"><h3 id="settings-defaults" tabIndex={-1}>Defaults</h3><div className="box">
        <div className="r"><span className="k">Quality<small>Best takes the highest stream a source offers</small></span><Chips value={draft.preferredQuality} options={QUALITIES} onChange={(preferredQuality) => setDraft({ ...draft, preferredQuality })} /></div>
        <div className="r"><span className="k">Audio<small>Used when a source offers both</small></span><Chips value={draft.preferredMode} options={["sub", "dub"] as const} onChange={(preferredMode) => setDraft({ ...draft, preferredMode })} /></div>
        <div className="r"><span className="k">Preferred source<small>Search checks every source that is on. Auto plays from the first available</small></span><Chips value={draft.preferredProvider} options={["auto", ...enabledProviders(draft)] as ProviderPreference[]} onChange={(preferredProvider) => setDraft({ ...draft, preferredProvider })} /></div>
      </div></div>
      <div className="group"><h3 id="settings-appearance" tabIndex={-1}>Appearance</h3><div className="box">
        <div className="r stack"><span className="k">Theme<small>Presets match common terminal schemes</small></span><span className="tiles" role="radiogroup" aria-label="theme">
          {THEME_NAMES.map((name) => {
            const colours = resolveTheme(name, draft.customTheme);
            return (
              <button type="button" key={name} role="radio" aria-checked={draft.theme === name} className={`tile${draft.theme === name ? " on" : ""}`}
                style={{ "--t-bg": colours.background, "--t-text": colours.text, "--t-cur": colours.highlight } as React.CSSProperties}
                onClick={() => setDraft({ ...draft, theme: name, customTheme: name === "custom" && draft.theme !== "custom" ? { ...resolveTheme(draft.theme, draft.customTheme) } : draft.customTheme })}>
                <span className="prev" aria-hidden="true"><i /><i /><b /></span><span>{name.replace("-", " ")}</span>
              </button>
            );
          })}
        </span></div>
        {draft.theme === "custom" && (
          <div className="r"><span className="k">Custom colours<small>Every other tone is mixed from these three</small></span><span className="swatches">
            {(["background", "text", "highlight"] as const).map((key) => (
              <span className="swatch" key={key}>
                <input type="color" value={draft.customTheme[key]} aria-label={`${key} colour`} onChange={(event) => setDraft({ ...draft, customTheme: { ...draft.customTheme, [key]: event.target.value } })} />
                <span>{key}</span>
                <input value={draft.customTheme[key]} aria-label={`${key} hex`} maxLength={7} spellCheck={false} onChange={(event) => setDraft({ ...draft, customTheme: { ...draft.customTheme, [key]: event.target.value } })} />
              </span>
            ))}
          </span></div>
        )}
        <div className="r"><span className="k">Backdrop art<small>An illustration behind the home, saved, and recent pages, from a hand-picked set on nekosapi.com. Off keeps them plain and fetches nothing</small></span><Switch checked={draft.emptyBackdrop !== false} label="Backdrop art" onChange={(emptyBackdrop) => setDraft({ ...draft, emptyBackdrop })} /></div>
      </div></div>
      <IdentityIndexPanel saved={saved} draft={draft} onChange={setDraft} />
      <BookmarkMetadataPanel count={bookmarkCount} saved={saved} draft={draft} />
      <SourceStatusPanel saved={saved} draft={draft} onChange={setDraft}>
        <div className="r"><span className="k">Source links<small>{linkCount} remembered {linkCount === 1 ? "anime" : "anime"} with records on more than one source. Forget them if series show the wrong records together; splitting one source on its series page is the smaller fix</small></span><button type="button" className="btn small" disabled={!linkCount} onClick={() => onClearLinks()}>forget links</button></div>
      </SourceStatusPanel>
      <div className="acts-row"><button type="button" className="btn" onClick={onCancel}>cancel</button><button type="submit" className="btn primary" disabled={!dirty}>save changes</button></div>
    </form>
    <nav className="settings-section-nav" aria-label="Settings sections">{sections.map((section) => <button type="button" key={section.id} aria-current={active === section.id ? "location" : undefined} onClick={() => jump(section.id)}>{section.label}</button>)}</nav>
    </div>
  );
}

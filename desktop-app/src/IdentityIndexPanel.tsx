import { useEffect, useRef, useState } from "react";
import type { IdentityIndexStatus, Settings } from "../shared/contracts";
import { messageFrom } from "./errors";
import Switch from "./Switch";

/** The Anime information settings group: the metadata service switch and the offline title index with its update control. */
export default function IdentityIndexPanel({ saved, draft, onChange }: { saved: Settings; draft: Settings; onChange: (settings: Settings) => void }) {
  const [status, setStatus] = useState<IdentityIndexStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const session = useRef({ active: true });

  useEffect(() => {
    const current = { active: true };
    session.current = current;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await window.aniDesktop.identityIndexStatus();
        if (current.active) { setStatus(value); setError(""); }
      } catch (failure) {
        if (current.active) setError(messageFrom(failure));
      } finally {
        if (current.active) timer = setTimeout(() => void read(), status?.updating ? 1000 : 5000);
      }
    };
    void read();
    return () => { current.active = false; clearTimeout(timer); };
  }, [saved.offlineIndex]);

  const update = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const value = await window.aniDesktop.updateIdentityIndex();
      if (session.current.active) { setStatus(value); if (value.error) setError(value.error); }
    } catch (failure) {
      if (session.current.active) setError(messageFrom(failure));
    } finally {
      if (session.current.active) setBusy(false);
    }
  };

  const unsaved = draft.offlineIndex !== saved.offlineIndex;
  const updating = busy || status?.updating === true;
  const updated = status?.updatedAt ? new Date(status.updatedAt).toLocaleDateString([], { day: "numeric", month: "short" }) : undefined;
  const indexState = !saved.offlineIndex ? "Search groups titles with the sources' own names and the information service."
    : updating ? "Downloading and preparing the title index…"
    : status?.entries ? `${status.entries.toLocaleString()} titles${updated ? ` · updated ${updated}` : ""}. Refreshes weekly.`
    : "Not downloaded yet. About six megabytes, refreshed weekly.";
  return <div className="group"><h3 id="settings-anime-information" tabIndex={-1}>Anime information</h3><div className="box">
    <div className="r"><span className="k">Series details from AniList<small>Synopsis, studio, status, and the ids that group one anime across sources. Titles of series you open are sent to AniList; answers are kept locally and refreshed by age.</small></span>
      <Switch checked={draft.animeInfo !== false} label="Series details from AniList" onChange={(animeInfo) => onChange({ ...draft, animeInfo })} /></div>
    <div className="r"><span className="k">Offline title index<small>A local copy of the anime-offline-database, so search can group titles across sources without any request.</small></span>
      <Switch checked={draft.offlineIndex === true} label="Offline title index" onChange={(offlineIndex) => onChange({ ...draft, offlineIndex })} /></div>
    <div className="r"><span className="k" role="status">{unsaved ? "Applying the index setting…" : indexState}{error && <small className="err" role="alert">{error}</small>}</span>
      <button type="button" className="btn small" disabled={!saved.offlineIndex || unsaved || updating} onClick={() => void update()}>{updating ? "Updating…" : status?.entries ? "Update now" : "Download"}</button></div>
  </div></div>;
}

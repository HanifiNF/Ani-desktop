import type { UpdateStatus } from "../shared/contracts";

interface Actions {
  onCheck: () => void;
  onOpen: () => void;
}

export function UpdateBanner({ status, onOpen, onDismiss }: { status: UpdateStatus; onOpen: () => void; onDismiss: () => void }) {
  if (status.state !== "available" || status.dismissed || !status.latestVersion) return null;
  return <aside className="update-banner" role="status">
    <span><b>ANIdesktop v{status.latestVersion} is available</b>{status.stale && <small>saved update information</small>}</span>
    <span className="update-actions">
      <button type="button" className="btn small primary" onClick={onOpen}>View release</button>
      <button type="button" className="link" onClick={onDismiss}>Later</button>
    </span>
  </aside>;
}

const checked = (timestamp?: number): string => timestamp === undefined ? "Never checked" : `Last checked ${new Date(timestamp).toLocaleString()}`;

export function UpdatePanel({ status, checking, onCheck, onOpen }: { status?: UpdateStatus; checking: boolean } & Actions) {
  const detail = !status ? "ANIdesktop will check shortly after startup."
    : status.state === "development" ? "Automatic checks are disabled while running from source."
    : status.state === "available" ? `Version ${status.latestVersion} is available${status.dismissed ? " (reminder dismissed)" : ""}.`
    : status.state === "current" ? `Version ${status.currentVersion} is up to date.`
    : status.error ?? "Could not check for updates.";
  return <div className="group update-settings"><h3 id="settings-updates" tabIndex={-1}>Updates</h3><div className="box">
    <div className="r"><span className="k">Application updates<small>{detail} {status?.stale ? "Showing the last valid result." : ""}</small></span>
      <span className="v-row">
        {status?.state === "available" && <button type="button" className="btn small" onClick={onOpen}>view release</button>}
        <button type="button" className="btn small" disabled={checking} onClick={onCheck}>{checking ? "checking…" : "check now"}</button>
      </span>
    </div>
    <div className="update-meta"><span>Installed {status ? `v${status.currentVersion}` : "version loading"}</span><span>{checked(status?.checkedAt)}</span></div>
    {status?.error && status.state !== "error" && <div className="group-note">{status.error}</div>}
  </div></div>;
}

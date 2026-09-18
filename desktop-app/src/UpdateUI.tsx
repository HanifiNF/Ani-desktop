import type { UpdateStatus } from "../shared/contracts";

/** A newer release the user has yet to skip. It lights the dot on the gear, the dot in the rail, and the link beside the Settings heading. */
export const updatePending = (status?: UpdateStatus): status is UpdateStatus & { latestVersion: string } =>
  status?.state === "available" && !status.dismissed && Boolean(status.latestVersion);

/** The link beside the Settings heading; it jumps to the Updates row. */
export function UpdateNotice({ status, onJump }: { status?: UpdateStatus; onJump: () => void }) {
  if (!updatePending(status)) return null;
  return <button type="button" className="update-notice" onClick={onJump}><i aria-hidden="true" />v{status.latestVersion} available</button>;
}

/** "checked today 00:28", or the date once the check is older than today. */
function checked(timestamp?: number): string {
  if (timestamp === undefined) return "never checked";
  const at = new Date(timestamp);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? `checked today ${time}` : `checked ${at.toLocaleDateString()} ${time}`;
}

interface PanelProps { status?: UpdateStatus; checking: boolean; onCheck: () => void; onOpen: () => void; onSkip: () => void }

export function UpdatePanel({ status, checking, onCheck, onOpen, onSkip }: PanelProps) {
  const available = status?.state === "available" && Boolean(status.latestVersion);
  const title = available ? `Version ${status?.latestVersion} is available`
    : status?.state === "current" ? "ANIdesktop is up to date"
    : "Application updates";
  const detail = !status ? "ANIdesktop will check shortly after startup."
    : status.state === "development" ? "Automatic checks are disabled while running from source."
    : available ? `You have ${status.currentVersion} · ${checked(status.checkedAt)}${status.dismissed ? " · skipped" : ""}`
    : status.state === "current" ? `Version ${status.currentVersion} · ${checked(status.checkedAt)}`
    : `${status.error ?? "Could not check for updates."} Installed v${status.currentVersion}.`;
  return <div className="group update-settings"><h3 id="settings-updates" tabIndex={-1}>Updates</h3><div className="box">
    <div className="r"><span className="k">{title}<small>{detail}{status?.stale ? " Showing the last valid result." : ""}</small></span>
      <span className="v-row">
        {updatePending(status) && <button type="button" className="link" onClick={onSkip}>skip this version</button>}
        {available
          ? <button type="button" className="link" disabled={checking} onClick={onCheck}>{checking ? "checking…" : "check again"}</button>
          : <button type="button" className="btn small" disabled={checking} onClick={onCheck}>{checking ? "checking…" : "check now"}</button>}
        {available && <button type="button" className="btn small primary" onClick={onOpen}>View release</button>}
      </span>
    </div>
    {status?.error && status.state !== "error" && <div className="group-note">{status.error}</div>}
  </div></div>;
}

import { useEffect, useState } from "react";
import type { EpisodeUpdate, EpisodeUpdateStatus } from "../shared/contracts";
import Art from "./Art";
import { Icon } from "./icons";

interface Actions {
  status?: EpisodeUpdateStatus;
  posterFor: (update: EpisodeUpdate) => string | undefined;
  onEpisode: (id: string) => void;
  onSeries: (id: string) => void;
  onMarkRead: (id?: string) => void;
  onDismiss: (id?: string) => void;
}

interface PanelProps extends Actions { onClose: () => void; onViewAll: () => void }

function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  return now;
}

export function notificationAge(time: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(time).toLocaleDateString();
}

const title = (update: EpisodeUpdate) => `Episode ${update.episodeNumber} of ${update.title}`;
const message = (update: EpisodeUpdate) => `Episode ${update.episodeNumber} is now available!`;

function Poster({ update, posterFor }: { update: EpisodeUpdate; posterFor: Actions["posterFor"] }) {
  return <Art src={posterFor(update)} className="notification-poster" />;
}

export default function EpisodeUpdatesPanel({ status, posterFor, onEpisode, onDismiss, onClose, onViewAll }: PanelProps) {
  const now = useClock();
  return <section className="episode-updates-panel" aria-label="Notifications">
    <header><strong>Notifications</strong><span className="notification-panel-actions"><button type="button" onClick={() => onDismiss()} disabled={!status?.updates.length}>Clear <Icon name="trash" /></button><button type="button" onClick={onClose} aria-label="Close notifications"><Icon name="x" /></button></span></header>
    <div className="episode-updates-list">
      {status?.updates.length ? status.updates.map((update) => <article className={`notification-preview${update.readAt ? " read" : " unread"}`} key={update.id}>
        <Poster update={update} posterFor={posterFor} />
        <div className="notification-preview-copy"><b>{!update.readAt && <span className="notification-dot" aria-hidden="true" />}{title(update)}</b><p>{message(update)}</p>
          <div className="notification-preview-foot"><button type="button" onClick={() => onEpisode(update.id)}>View episode <Icon name="chevron" /></button><time dateTime={new Date(update.detectedAt).toISOString()}>{notificationAge(update.detectedAt, now)}</time></div>
        </div>
      </article>) : <p className="notification-empty">No notifications yet.</p>}
    </div>
    <button type="button" className="episode-updates-view-all" onClick={onViewAll}>View all notifications <Icon name="chevron" /></button>
  </section>;
}

export function EpisodeUpdatesPage({ status, posterFor, onEpisode, onSeries, onMarkRead, onDismiss }: Actions) {
  const now = useClock();
  return <section className="notifications-page" aria-labelledby="notifications-heading">
    <div className="notifications-page-head"><div><h1 id="notifications-heading">Notifications</h1><span className="notifications-unread-count">{status?.unreadCount ?? 0} new</span></div>
      <button type="button" className="btn" onClick={() => onMarkRead()} disabled={!status?.unreadCount}><Icon name="check" /> Mark all as read</button>
    </div>
    <div className="notifications-page-list">{status?.updates.length ? status.updates.map((update) => <article className={`notification-card${update.readAt ? " read" : " unread"}`} key={update.id}>
      <div className="notification-card-head"><Poster update={update} posterFor={posterFor} /><h2>{title(update)}</h2><span className="notification-card-actions">
        {!update.readAt && <button type="button" aria-label={`Mark ${title(update)} as read`} title="Mark as read" onClick={() => onMarkRead(update.id)}><Icon name="check" /></button>}
        <button type="button" aria-label={`Delete ${title(update)}`} title="Delete notification" onClick={() => onDismiss(update.id)}><Icon name="x" /></button>
      </span></div>
      <p>{message(update)}</p>
      <div className="notification-card-foot"><time dateTime={new Date(update.detectedAt).toISOString()}>{notificationAge(update.detectedAt, now)}</time><span>
        <button type="button" className="btn small" onClick={() => onSeries(update.id)}>Series <Icon name="chevron" /></button>
        <button type="button" className="btn small" onClick={() => onEpisode(update.id)}>View episode <Icon name="chevron" /></button>
      </span></div>
    </article>) : <p className="notification-empty">No notifications yet. Updates for saved anime will appear here.</p>}</div>
  </section>;
}

import { useEffect, useState } from "react";
import { Icon } from "./icons";

/** The quiet icon after a series title: copies the title, then shows a check for two seconds. The tooltip is drawn by CSS from data-tip, so the heading's text stays the title alone. */
export default function CopyTitle({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => setCopied(false), [title]);
  return <button type="button" className={`copy-title ${copied ? "done" : ""}`} aria-label={copied ? "Title copied" : "Copy title"} data-tip={copied ? "Copied" : "Copy title"}
    onClick={() => { void window.aniDesktop.copyText(title).then(() => setCopied(true), () => undefined); }}>
    <Icon name={copied ? "check" : "copy"} />
  </button>;
}

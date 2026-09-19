import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { chipsThatFit } from "./schedule";

const CHIP_GAP = 4;

/** Genre chips on one line: whole chips only, then a "+n" chip naming how many did not fit (hover lists them). */
export default function GenreChips({ genres }: { genres: string[] }) {
  const key = genres.join("\u001f");
  const list = useMemo(() => key ? key.split("\u001f") : [], [key]);
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState({ key, visible: list.length });
  // A new genre list renders every chip first so they can be measured, then settles on how many fit.
  if (fit.key !== key) setFit({ key, visible: list.length });
  const widths = useRef<{ key: string; chips: number[] } | undefined>(undefined);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => {
      if (widths.current?.key !== key) {
        const chips = [...host.querySelectorAll<HTMLElement>(".tag:not(.more)")];
        if (chips.length !== list.length || chips.some((chip) => chip.hidden)) return;
        widths.current = { key, chips: chips.map((chip) => chip.offsetWidth) };
      }
      const more = host.querySelector<HTMLElement>(".more")?.offsetWidth ?? 0;
      const visible = chipsThatFit(host.clientWidth, widths.current.chips, CHIP_GAP, more);
      setFit((current) => current.key === key && current.visible === visible ? current : { key, visible });
    };
    measure();
    const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : undefined;
    observer?.observe(host);
    return () => observer?.disconnect();
  }, [key, list]);
  if (!list.length) return null;
  const visible = fit.key === key ? fit.visible : list.length;
  const rest = list.slice(visible);
  return <span ref={ref} className="tags">
    {list.map((genre, index) => <span key={genre} className="tag" hidden={index >= visible}>{genre}</span>)}
    <span className={`tag more ${rest.length ? "" : "probe"}`} title={rest.length ? rest.join(", ") : undefined} aria-hidden={!rest.length}>+{rest.length || 9}</span>
  </span>;
}

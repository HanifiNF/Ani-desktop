import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Target = { id: string } | { number: string };
interface Anchor { element: HTMLElement; top: number; }

// Layout coordinates exclude the staggered entrance transforms on episode rows.
function layoutTop(element: HTMLElement): number {
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
  return top;
}

/** Own series scrolling: preserve the reading position and perform explicit, cancellable jumps. */
export function useSeriesScroll(list: RefObject<HTMLDivElement | null>, active: boolean, loading: boolean) {
  const [, update] = useState(0);
  const state = useRef({ page: undefined as HTMLElement | undefined, anchors: [] as Anchor[], offset: 0,
    reset: false, pending: undefined as Target | undefined });
  const reconcileRef = useRef<() => void>(() => {});

  const begin = useCallback((id?: string) => {
    state.current.reset = true;
    state.current.pending = id ? { id } : undefined;
    update((value) => value + 1);
  }, []);
  const reveal = useCallback((target: Target) => {
    if (state.current.page) capture(state.current.page);
    state.current.pending = target;
    // A second request for the same episode is still a new scroll command.
    update((value) => value + 1);
  }, [list]);
  const cancelReveal = useCallback(() => { state.current.pending = undefined; }, []);

  function capture(page: HTMLElement) {
    const current = state.current;
    current.offset = page.scrollTop;
    current.anchors = [];
    if (current.offset <= 1) return;
    const origin = layoutTop(page);
    const candidates = list.current?.closest(".series")?.querySelectorAll<HTMLElement>(
      ".main > .crumb, .main > h1, .main > .meta, .main > .facts, .main > .about, .main > .ep-head, [data-episode]"
    ) ?? [];
    let previous: Anchor | undefined;
    for (const element of candidates) {
      const top = layoutTop(element) - origin - current.offset;
      const anchor = { element, top };
      if (top + element.offsetHeight <= 0) { previous = anchor; continue; }
      // Keep visible elements and one neighbour as fallbacks if a source/filter removes a row.
      if (top >= page.clientHeight) {
        if (current.anchors.length) current.anchors.push(anchor);
        break;
      }
      current.anchors.push(anchor);
    }
    if (previous && current.anchors.length) current.anchors.push(previous);
  }

  reconcileRef.current = () => {
    const page = active ? list.current?.closest<HTMLElement>(".page") : undefined;
    const current = state.current;
    if (!page) return;
    if (page !== current.page || current.reset) {
      current.page = page; current.reset = false; current.anchors = []; current.offset = 0;
      page.scrollTop = 0;
    }
    // Account for wheel/scrollbar movement even when its scroll event is still queued.
    const movement = page.scrollTop - current.offset;
    if (movement) current.pending = undefined;
    const target = current.pending;
    const selected = target && [...(list.current?.querySelectorAll<HTMLElement>("[data-episode]") ?? [])]
      .find((row) => "id" in target ? row.dataset.episode === target.id : row.dataset.episodeNumber === target.number);
    const origin = layoutTop(page);
    if (selected) {
      const top = layoutTop(selected) - origin;
      if (top < page.scrollTop + 8) page.scrollTop = Math.max(0, top - 8);
      else if (top + selected.offsetHeight > page.scrollTop + page.clientHeight - 8) {
        page.scrollTop = top + selected.offsetHeight - page.clientHeight + 8;
      }
      current.pending = undefined;
    } else {
      if (!loading) current.pending = undefined;
      const anchor = current.anchors.find(({ element }) => element.isConnected && page.contains(element));
      if (anchor && page.scrollTop > 1) {
        const offset = layoutTop(anchor.element) - origin - anchor.top + movement;
        if (offset !== page.scrollTop) page.scrollTop = offset;
      }
    }
    capture(page);
  };

  // React commits cover source/metadata updates; the observer also covers child-only
  // synopsis expansion, font/layout changes and window resizing. Neither follows selection.
  useLayoutEffect(() => { reconcileRef.current(); });
  useLayoutEffect(() => {
    const page = active ? list.current?.closest<HTMLElement>(".page") : undefined;
    if (!page) {
      state.current.page = undefined; state.current.anchors = []; state.current.pending = undefined;
      return;
    }
    const scroll = () => {
      if (page.scrollTop !== state.current.offset) cancelReveal();
      capture(page);
    };
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancelReveal();
    };
    const pointer = (event: PointerEvent) => { if (event.target === page) cancelReveal(); };
    page.addEventListener("scroll", scroll, { passive: true });
    page.addEventListener("wheel", cancelReveal, { passive: true });
    page.addEventListener("touchmove", cancelReveal, { passive: true });
    page.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", key);
    const observer = new ResizeObserver(() => reconcileRef.current());
    observer.observe(page);
    const series = list.current?.closest(".series");
    if (series) observer.observe(series);
    return () => {
      observer.disconnect();
      page.removeEventListener("scroll", scroll);
      page.removeEventListener("wheel", cancelReveal);
      page.removeEventListener("touchmove", cancelReveal);
      page.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key);
    };
  }, [active, list, cancelReveal]);

  return { begin, reveal, cancelReveal };
}

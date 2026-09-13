import { useCallback, useEffect, useRef, useState } from "react";
import type { AnimeResult, CatalogRequest, SeriesMetadataCatalog } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import { catalogRequestId } from "./catalog-request";

const idsOf = (anime: AnimeResult) => animeSources(anime).map((source) => source.id).sort();

export function useSeriesMetadata(sourceScope: string) {
  const [catalogs, setCatalogs] = useState<Record<string, SeriesMetadataCatalog>>({});
  const tasks = useRef(new Map<string, string>());

  useEffect(() => {
    for (const id of tasks.current.values()) window.aniDesktop.cancelCatalog(id);
    tasks.current.clear(); setCatalogs({});
  }, [sourceScope]);

  const remember = useCallback((ids: string[], value: SeriesMetadataCatalog) => {
    setCatalogs((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = value;
      return next;
    });
  }, []);

  const load = useCallback((anime: AnimeResult, priority: NonNullable<CatalogRequest["priority"]> = "visible", refresh = false) => {
    const ids = idsOf(anime), key = ids.join("|");
    if (!key || tasks.current.has(key)) return;
    const id = catalogRequestId("series-metadata");
    tasks.current.set(key, id);
    const update = (value: SeriesMetadataCatalog) => remember(ids, value);
    void window.aniDesktop.seriesMetadata(anime, { id, priority, refresh }, update)
      .then(update).catch(() => undefined).finally(() => { if (tasks.current.get(key) === id) tasks.current.delete(key); });
  }, [remember, sourceScope]);

  const get = useCallback((anime: AnimeResult): SeriesMetadataCatalog | undefined => {
    for (const id of idsOf(anime)) if (catalogs[id]) return catalogs[id];
    return undefined;
  }, [catalogs]);

  return { get, load };
}

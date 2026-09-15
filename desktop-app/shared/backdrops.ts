import type { BackdropKind } from "./contracts";

export interface BackdropEntry { id: number; kind: BackdropKind; }

/** The API that resolves an image id to its file and source; images are served from its CDN. */
export const BACKDROP_API = "https://api.nekosapi.com/v4/images";
export const BACKDROP_CREDIT_URL = "https://nekosapi.com/";

/**
 * Illustrations shown behind the home, saved, and recent pages, by nekosapi.com image id. The pool is picked by hand rather than
 * requested at random: the service's "safe" rating lets explicit images through, and it has no way to mark or
 * exclude generated art. Wide images suit the wash across the top of a page, portraits the corner.
 */
export const BACKDROP_POOL: readonly BackdropEntry[] = [
  { id: 8879, kind: "wide" }, { id: 20268, kind: "wide" }, { id: 3295, kind: "wide" }, { id: 9002, kind: "wide" },
  { id: 11649, kind: "portrait" }, { id: 17201, kind: "portrait" }, { id: 1876, kind: "portrait" }, { id: 41078, kind: "portrait" },
  { id: 32082, kind: "portrait" }, { id: 19118, kind: "portrait" }, { id: 6708, kind: "portrait" }, { id: 2524, kind: "portrait" },
  { id: 15502, kind: "portrait" }, { id: 3754, kind: "portrait" }, { id: 5834, kind: "portrait" }, { id: 17128, kind: "portrait" },
  { id: 30444, kind: "portrait" }, { id: 7579, kind: "portrait" }, { id: 1868, kind: "portrait" }, { id: 25265, kind: "portrait" },
  { id: 18542, kind: "portrait" }, { id: 16065, kind: "portrait" }, { id: 9929, kind: "portrait" }, { id: 4816, kind: "portrait" },
  { id: 5048, kind: "portrait" }, { id: 10759, kind: "portrait" }, { id: 1236, kind: "portrait" }, { id: 16820, kind: "portrait" },
  { id: 7470, kind: "portrait" }
];

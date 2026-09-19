import { describe, expect, it, vi } from "vitest";
import { browseMatch, findBrowseSource, identified, knownCandidate, rememberedBrowseAnime } from "../src/browse-source";
import type { AnimeResult, BrowseAnime, Work } from "../shared/contracts";

const anime: BrowseAnime = { anilistId: 42, refs: ["anilist:42", "mal:42"], title: "Example Season 2", titles: ["Example Season 2", "Other Name 2", "Another Name 2", "Fourth Name"], genres: [], studios: [], type: "TV", year: 2020, status: "finished" };
const hit = (refs: string[] = [], title = anime.title): AnimeResult => ({ id: "aniwave:example-1", provider: "aniwave", title, refs });
const work: Work = { id: "work:1234567890123456", title: anime.title, refs: anime.refs, records: ["aniwave:example-1", "hianime:example"], updatedAt: new Date().toISOString(), type: "TV", year: 2020 };

describe("browse identity", () => {
  it("rejects conflicting IDs even with another shared ID or an identical title", () => {
    expect(browseMatch(anime, [hit(["anilist:42", "mal:99"])] )).toBeUndefined();
    expect(browseMatch(anime, [hit(["anilist:99"])] )).toBeUndefined();
  });
  const stating = (refs: string[], facts: object, title = anime.title): AnimeResult => ({ ...hit(refs, title), sources: [{ id: "aniwave:example-1", provider: "aniwave", title, aliases: [], ...facts }] });
  it("rejects a conflicting source reference, and a conflicting format or year when only titles agree", () => {
    expect(browseMatch(anime, [stating(anime.refs, { refs: ["mal:99"] })])).toBeUndefined();
    for (const facts of [{ type: "MOVIE" as const }, { year: 2021 }]) expect(browseMatch(anime, [stating([], facts)])).toBeUndefined();
    expect(browseMatch(anime, [stating([], {}, `${anime.title} (2021)`)])).toBeUndefined();
  });
  it("lets a shared ID settle identity when catalogues disagree on year or format", () => {
    // A December premiere belongs to the next year's winter season on AniList and to the premiere year on a provider.
    for (const facts of [{ type: "ONA" as const }, { year: 2019 }]) {
      const row = stating(["mal:42"], facts, "Provider spelling");
      expect(browseMatch(anime, [hit(), row])).toBe(row);
    }
  });
  it("matches a release variant by title only when no plain spelling matches", () => {
    const variant = hit([], "Example Season 2 (Uncensored)");
    expect(browseMatch(anime, [variant])).toBe(variant);
    const plain = { ...hit(), id: "aniwave:example-2" };
    expect(browseMatch(anime, [variant, plain])).toBe(plain);
    expect(browseMatch(anime, [variant, { ...hit([], "Example Season 2 (Dub)"), id: "aniwave:example-3" }])).toBeUndefined();
  });
  it("ignores the announced episode total, which a provider may not have reached", () => {
    const row = stating([], { episodes: 3 });
    expect(browseMatch({ ...anime, episodes: 24 }, [row])).toBe(row);
  });
  it("carries the entry's references into the opened row and describes the entry as an identified work", () => {
    expect(identified(anime, hit(["mal:42"])).refs).toEqual(["mal:42", "anilist:42"]);
    expect(identified(anime, { id: "aniwave:example-1", provider: "aniwave", title: anime.title }).refs).toEqual(anime.refs);
    expect(knownCandidate({ ...anime, episodes: 24 })).toEqual({ refs: anime.refs, title: anime.title, titles: anime.titles, status: "finished", type: "TV", year: 2020, episodes: 24 });
  });
  it("prefers references, accepts a unique alias, and leaves ambiguous matches unresolved", () => {
    const correct = hit(anime.refs, "Provider title");
    expect(browseMatch(anime, [hit(), correct])).toBe(correct);
    const alias = { ...hit([], "Provider title"), sources: [{ id: "aniwave:example-1", provider: "aniwave" as const, title: "Provider title", aliases: ["OTHER NAME 2!"] }] };
    expect(browseMatch(anime, [alias])).toBe(alias);
    expect(browseMatch(anime, [hit(), { ...hit(), id: "aniwave:example-2" }])).toBeUndefined();
    expect(browseMatch(anime, [hit([], "Example Season 1")])).toBeUndefined();
  });
  it("reuses confident remembered records only from enabled sources", () => {
    const known = rememberedBrowseAnime(anime, [work], { disabledSources: ["aniwave"] });
    expect(known?.sources?.map((source) => source.id)).toEqual(["hianime:example"]);
    expect(rememberedBrowseAnime(anime, [{ ...work, tentative: true }], {})).toBeUndefined();
    expect(rememberedBrowseAnime(anime, [{ ...work, refs: ["anilist:42", "mal:99"] }], {})).toBeUndefined();
  });
});

describe("bounded browse discovery", () => {
  it("tries aliases until a compatible source is found", async () => {
    const correct = hit(anime.refs, "Other Name 2");
    const search = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([correct]);
    expect(await findBrowseSource(anime, search)).toBe(correct);
    expect(search.mock.calls.map(([query]) => query)).toEqual([anime.title, "Other Name 2"]);
  });
  it("skips repeated and overlength spellings and caps provider searches at three", async () => {
    const search = vi.fn().mockResolvedValue([]);
    await findBrowseSource({ ...anime, titles: [anime.title.toUpperCase(), "x".repeat(121), ...anime.titles] }, search);
    expect(search.mock.calls.map(([query]) => query)).toEqual([anime.title, "Other Name 2", "Another Name 2"]);
  });
  it("stops on cancellation or an all-provider failure", async () => {
    const error = new DOMException("Cancelled", "AbortError");
    const search = vi.fn().mockRejectedValue(error);
    await expect(findBrowseSource(anime, search)).rejects.toBe(error);
    expect(search).toHaveBeenCalledOnce();
  });
});

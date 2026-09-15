import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AnimeResult, IdentityCandidate, Work } from "../shared/contracts";
import { expandWithLinks, likelyDuplicate, sourceMatch, unifyAnimeResults } from "../shared/catalog";
import { bestCandidate, coreTitle, seasonSignature, titleKeys } from "../shared/identity";
import { parseAniwaveSearch, parseHiAnimeSearch } from "../electron/parsers";

const anime = (id: string, title: string, aliases = [title], extra: Partial<AnimeResult["sources"] extends (infer S)[] | undefined ? S : never> = {}): AnimeResult => {
  const provider = id.startsWith("aniwave:") ? "aniwave" as const : id.startsWith("hianime:") ? "hianime" as const : "anidb" as const;
  return { id, title, provider, sources: [{ id, title, provider, aliases, ...extra }] };
};
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const jojo = () => [...parseAniwaveSearch(fixture("aniwave-jojo-search.html")), ...parseHiAnimeSearch(fixture("hianime-jojo-search.json"))];
const providersOf = (result: AnimeResult) => result.sources?.map((source) => source.provider) ?? [];

describe("title matching", () => {
  it("reads season markers strictly and strips release qualifiers", () => {
    expect(seasonSignature("JoJo's Bizarre Adventure: Stone Ocean Part 2")).toBe("p2");
    expect(seasonSignature("JoJo's Bizarre Adventure Part 3: Stardust Crusaders 2nd Season")).toBe("p3s2");
    expect(seasonSignature("Vinland Saga Season 2")).toBe("s2");
    expect(seasonSignature("Vinland Saga 2")).toBe("s2");
    expect(seasonSignature("Frieren")).toBe("");
    expect(seasonSignature("JoJo's Bizarre Adventure (2000)")).toBe("");
    expect(coreTitle("Example (Uncensored) Season 2")).toBe("example");
    expect([...titleKeys({ title: "Example (Uncensored)" })]).toEqual(["example uncensored", "example"]);
  });

  it("does not treat a shared franchise name with different markers as the same anime", () => {
    expect(likelyDuplicate(anime("aniwave:so-1", "JoJo's Bizarre Adventure: Stone Ocean Part 2"), anime("hianime:sc-2", "JoJo's Bizarre Adventure Part 3: Stardust Crusaders 2nd Season"))).toBe(false);
    expect(likelyDuplicate(anime("aniwave:show-1", "Example Season 1"), anime("anidb:show-2", "Example Season 2"))).toBe(false);
    expect(likelyDuplicate(anime("aniwave:show-1", "Example"), anime("anidb:show-special-2", "Example Special"))).toBe(false);
  });

  it("matches the same season of the same title unless a stated fact disagrees", () => {
    expect(likelyDuplicate(anime("aniwave:rezero-1", "Re:ZERO Season 4"), anime("anidb:rezero-2", "Re:ZERO -Starting Life in Another World- Season 4", ["Re:ZERO -Starting Life in Another World- Season 4", "Re:ZERO 4th Season"]))).toBe(true);
    expect(likelyDuplicate(anime("aniwave:show-1", "Example", ["Example"], { type: "TV" }), anime("hianime:show-2", "Example", ["Example"], { type: "MOVIE" }))).toBe(false);
    expect(likelyDuplicate(anime("aniwave:show-1", "Example (2012)"), anime("hianime:show-2", "Example (2000)"))).toBe(false);
    expect(likelyDuplicate(anime("aniwave:show-1", "Example", ["Example"], { episodes: 12 }), anime("hianime:show-2", "Example", ["Example"], { episodes: 26 }))).toBe(false);
    expect(likelyDuplicate(anime("aniwave:show-1", "Example", ["Example"], { episodes: 12 }), anime("hianime:show-2", "Example", ["Example"], { episodes: 14 }))).toBe(true);
  });
});

describe("multi-source catalog identity", () => {
  it("combines exact normalized English aliases and keeps both source IDs", () => {
    const results = unifyAnimeResults([
      anime("aniwave:rezero-82570", "Re:ZERO -Starting Life in Another World- Season 4", ["Re:ZERO -Starting Life in Another World- Season 4", "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season"]),
      anime("anidb:rezero-4", "Re:ZERO Starting Life in Another World Season 4")
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].sources?.map((source) => source.id)).toEqual(["aniwave:rezero-82570", "anidb:rezero-4"]);
    expect(results[0].tentative).toBeUndefined();
  });

  it("does not automatically combine different seasons or merely similar titles", () => {
    expect(unifyAnimeResults([anime("aniwave:show-1", "Example Season 1"), anime("anidb:show-2", "Example Season 2")])).toHaveLength(2);
    expect(unifyAnimeResults([anime("aniwave:show-1", "Example"), anime("anidb:show-special-2", "Example Special")])).toHaveLength(2);
  });

  it("groups records that share an external reference, including two from one provider", () => {
    const results = unifyAnimeResults([
      anime("aniwave:frieren-1", "Frieren: Beyond Journey's End"),
      anime("hianime:frieren-a", "Sousou no Frieren (Uncensored)", ["Sousou no Frieren (Uncensored)"], { refs: ["mal:52991"] }),
      anime("hianime:frieren-b", "Sousou no Frieren", ["Sousou no Frieren"], { refs: ["mal:52991"] })
    ]);
    expect(results).toHaveLength(2);
    expect(results[1].sources?.map((source) => source.id)).toEqual(["hianime:frieren-a", "hianime:frieren-b"]);
    expect(results[1].refs).toEqual(["mal:52991"]);
  });

  it("uses remembered works and legacy links without title matching", () => {
    const left = anime("aniwave:frieren-1", "Sousou no Frieren");
    const right = anime("anidb:frieren-2", "Frieren Beyond Journey's End");
    expect(unifyAnimeResults([left, right])).toHaveLength(2);
    expect(unifyAnimeResults([left, right], [[left.id, right.id]])).toHaveLength(1);
    const work: Work = { id: "work:abc", title: "Frieren", refs: ["mal:52991"], records: [left.id, right.id], updatedAt: "" };
    const grouped = unifyAnimeResults([left, right], [], { works: [work] });
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ workId: "work:abc", refs: ["mal:52991"] });
  });

  it("binds records through an index candidate that names both titles", () => {
    const candidate: IdentityCandidate = { refs: ["mal:52991", "anilist:154587"], title: "Sousou no Frieren", titles: ["Sousou no Frieren", "Frieren: Beyond Journey's End"], type: "TV", year: 2023, episodes: 28 };
    const results = unifyAnimeResults([anime("aniwave:frieren-1", "Frieren: Beyond Journey's End"), anime("hianime:frieren-x", "Sousou no Frieren")], [], { candidates: [candidate] });
    expect(results).toHaveLength(1);
    expect(results[0].refs).toEqual(["anilist:154587", "mal:52991"]);
    expect(results[0].tentative).toBeUndefined();
    expect(bestCandidate({ title: "Frieren: Beyond Journey's End", type: "MOVIE" }, [candidate])).toBeUndefined();
  });

  it("marks title-only groups as tentative and honours a split", () => {
    const left = anime("aniwave:rezero-1", "Re:ZERO Season 4"), right = anime("anidb:rezero-2", "Re:ZERO -Starting Life in Another World- Season 4", ["Re:ZERO -Starting Life in Another World- Season 4", "Re:ZERO 4th Season"]);
    const results = unifyAnimeResults([left, right]);
    expect(results).toHaveLength(1);
    expect(results[0].tentative).toBe(true);
    expect(unifyAnimeResults([left, right], [], { dismissed: ["anidb:rezero-2|aniwave:rezero-1"] })).toHaveLength(2);
  });

  it("grades another provider's search hits for source resolution", () => {
    const frieren = anime("aniwave:frieren-1", "Frieren: Beyond Journey's End", ["Frieren: Beyond Journey's End", "Sousou no Frieren"]);
    expect(sourceMatch(frieren, anime("anidb:frieren-2", "Sousou no Frieren"))).toBe("exact");
    expect(sourceMatch(frieren, anime("anidb:frieren-3", "Sousou no Frieren: Mini Anime"))).toBeUndefined();
    expect(sourceMatch({ ...frieren, refs: ["mal:52991"] }, anime("hianime:frieren-9", "Something Else", ["Something Else"], { refs: ["mal:52991"] }))).toBe("exact");
    expect(sourceMatch(anime("aniwave:rezero-1", "Re:ZERO Season 4"), anime("anidb:rezero-2", "Re:ZERO Starting Life in Another World Season 4", ["Re:ZERO Starting Life in Another World Season 4", "Re:ZERO 4th Season"]))).toBe("likely");
  });

  it("coalesces three groups when a third source bridges their exact aliases", () => {
    const results = unifyAnimeResults([
      anime("aniwave:example-1", "Example English"),
      anime("anidb:example-2", "作品名"),
      anime("hianime:example-series-abc123", "Example English", ["Example English", "作品名"])
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].sources?.map((source) => source.provider)).toEqual(["aniwave", "hianime", "anidb"]);
  });

  it("keeps one record per provider even when a remembered link spans several seasons", () => {
    const link = ["aniwave:frieren-1", "hianime:frieren-a", "aniwave:frieren-2", "hianime:frieren-b"];
    const results = unifyAnimeResults([
      anime("aniwave:frieren-1", "Frieren: Beyond Journey's End"), anime("hianime:frieren-a", "Frieren: Beyond Journey's End"),
      anime("aniwave:frieren-2", "Frieren: Beyond Journey's End Season 2"), anime("hianime:frieren-b", "Frieren: Beyond Journey's End Season 2")
    ], [link]);
    expect(results.map((result) => result.sources?.map((source) => source.id))).toEqual([["aniwave:frieren-1", "hianime:frieren-a"], ["aniwave:frieren-2", "hianime:frieren-b"]]);
  });

  it("expands an anime with the records a remembered link ties to it, one per provider", () => {
    const known = anime("aniwave:frieren-1", "Frieren");
    const expanded = expandWithLinks(known, [["aniwave:frieren-1", "anidb:frieren-2", "hianime:frieren-3", "hianime:frieren-4"]]);
    expect(expanded.sources?.map((source) => [source.id, source.provider, source.title])).toEqual([
      ["aniwave:frieren-1", "aniwave", "Frieren"], ["anidb:frieren-2", "anidb", "Frieren"], ["hianime:frieren-3", "hianime", "Frieren"]
    ]);
    expect(expandWithLinks(known, [["anidb:other-9", "hianime:other-8"]])).toBe(known);
  });

  it("does not combine duplicate records from the same provider without a reference or qualifier", () => {
    expect(unifyAnimeResults([anime("hianime:example-one-abc123", "Example"), anime("hianime:example-two-def456", "Example")])).toHaveLength(2);
  });

  it("keeps rows returned by the main process intact on a second pass", () => {
    const row: AnimeResult = { id: "aniwave:a-1", title: "A", provider: "aniwave", workId: "work:1", refs: ["mal:1"], sources: [
      { id: "aniwave:a-1", provider: "aniwave", title: "A", aliases: ["A"] }, { id: "hianime:b", provider: "hianime", title: "Completely different", aliases: ["Completely different"] }
    ] };
    expect(unifyAnimeResults([row])).toEqual([expect.objectContaining({ workId: "work:1", refs: ["mal:1"], sources: row.sources })]);
  });
});

describe("live JoJo search responses", () => {
  it("parses facts and references from both providers", () => {
    const [aniwave, hianime] = [parseAniwaveSearch(fixture("aniwave-jojo-search.html")), parseHiAnimeSearch(fixture("hianime-jojo-search.json"))];
    expect(aniwave).toHaveLength(11); expect(hianime).toHaveLength(18);
    expect(aniwave.find((hit) => hit.title === "JoJo's Bizarre Adventure: Stone Ocean Part 2")?.sources?.[0]).toMatchObject({ type: "ONA", episodes: 12 });
    expect(hianime.find((hit) => hit.title === "JoJo's Bizarre Adventure: Stone Ocean Part 2")?.sources?.[0]).toMatchObject({ type: "ONA", episodes: 12, year: 2022, refs: ["mal:51367"] });
  });

  it("collapses censored and uncensored copies and never pairs Stone Ocean Part 2 with Stardust Crusaders", () => {
    const rows = unifyAnimeResults(jojo());
    const byTitle = (title: string) => rows.filter((row) => row.title === title || row.sources?.some((source) => source.title === title));
    // Nine AniWave records meet a HiAnime record through the romaji alias; the two HiAnime copies join the same row by MyAnimeList id.
    expect(providersOf(byTitle("JoJo's Bizarre Adventure: Diamond Is Unbreakable")[0])).toEqual(["aniwave", "hianime", "hianime"]);
    expect(byTitle("JoJo's Bizarre Adventure: Stone Ocean Part 2")).toHaveLength(1);
    expect(byTitle("JoJo's Bizarre Adventure: Stone Ocean Part 2")[0].sources?.some((source) => /Stardust/.test(source.title))).toBe(false);
    // The only title-only group is the 2000 OVA, which AniWave tags "(OVA)" and HiAnime tags "(2000)"; both state OVA with seven episodes.
    expect(rows.filter((row) => row.tentative).map((row) => row.sources?.map((source) => source.title))).toEqual([["JoJo's Bizarre Adventure (OVA)", "JoJo's Bizarre Adventure (2000)"]]);
    expect(providersOf(byTitle("JoJo's Bizarre Adventure")[0])).toEqual(["aniwave", "hianime"]);
    // Two HiAnime titles for the 2007 film share a MyAnimeList id and become one row.
    expect(byTitle("JoJo's Bizarre Adventure: Phantom Blood")).toHaveLength(1);
    expect(byTitle("JoJo's Bizarre Adventure: Phantom Blood")[0].sources).toHaveLength(2);
    expect(rows.length).toBeLessThan(jojo().length - 12);
  });

  it("joins the AniWave-only season through an index candidate", () => {
    const candidate: IdentityCandidate = { refs: ["mal:26055", "anilist:20899"], title: "JoJo no Kimyou na Bouken Part 3: Stardust Crusaders 2nd Season",
      titles: ["JoJo no Kimyou na Bouken Part 3: Stardust Crusaders 2nd Season", "JoJo's Bizarre Adventure: Stardust Crusaders - Battle in Egypt", "JoJo's Bizarre Adventure Part 3: Stardust Crusaders 2nd Season"], type: "TV", year: 2015, episodes: 24 };
    const rows = unifyAnimeResults(jojo(), [], { candidates: [candidate] });
    const egypt = rows.find((row) => row.title === "JoJo's Bizarre Adventure: Stardust Crusaders - Battle in Egypt");
    expect(egypt?.refs).toEqual(["anilist:20899", "mal:26055"]);
    expect(providersOf(egypt!)).toEqual(["aniwave", "hianime", "hianime"]);
  });
});

describe("identity contradictions", () => {
  it("rejects same-title records carrying conflicting catalogue IDs", () => {
    expect(sourceMatch(anime("aniwave:a-1", "Same", [], { refs: ["mal:1"] }), anime("hianime:b-2", "Same", [], { refs: ["mal:2"] }))).toBeUndefined();
  });
  it("rejects shared-ID records whose format differs", () => {
    expect(sourceMatch(anime("aniwave:a-1", "Bundle", [], { refs: ["mal:1"], type: "OVA" }), anime("hianime:b-2", "Component", [], { refs: ["mal:1"], type: "MOVIE" }))).toBeUndefined();
  });
  it("allows an airing source's available count to differ from its planned total", () => {
    const candidate: IdentityCandidate = { title: "Series", titles: ["Series"], refs: ["mal:1"], status: "ongoing", episodes: 12 };
    expect(bestCandidate({ title: "Series", episodes: 3 }, [candidate])).toBe(candidate);
  });
});

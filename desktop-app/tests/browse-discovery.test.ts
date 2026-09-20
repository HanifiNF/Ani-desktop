import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AnimeResult, BrowseIdentity, ProviderName, Work } from "../shared/contracts";
import { BROWSE_QUERY_LIMIT } from "../shared/browse-source";
import { BrowseDiscovery, BROWSE_DISCOVERY_MS, BROWSE_HTTP_LIMIT } from "../electron/browse-discovery";
import { catalogContext } from "../electron/catalog-requests";
import { searchOne, type SourceConfig } from "../electron/scraper";
import { StateStore } from "../electron/state";

const config: SourceConfig = { preferredProvider: "auto", aniwaveBaseUrl: "https://browse-discovery.test", anidbBaseUrl: "https://browse-anidb.test", hianimeBaseUrl: "https://browse-hianime.test", disabledSources: ["anidb"] };
const anime: BrowseIdentity = { refs: ["anilist:263", "mal:263"], title: "Hajime no Ippo: The Fighting!",
  titles: ["Hajime no Ippo: The Fighting!", "Hajime no Ippo: THE FIGHTING!", "はじめの一歩 THE FIGHTING!", "The First Step", "Fighting Spirit", "Espíritu de lucha", "Hajime no Ippo: A Luta!", "Первый шаг"],
  type: "TV", year: 2000, episodes: 75, status: "finished" };
const hit = (provider: ProviderName, title = "Fighting Spirit", extra: Partial<AnimeResult> = {}): AnimeResult => ({
  id: `${provider}:ippo-1`, provider, title, sources: [{ id: `${provider}:ippo-1`, provider, title, aliases: [title, "Hajime no Ippo"], type: "TV", year: 2000 }], ...extra
});
const work: Work = { id: "work:1234567890123456", refs: anime.refs, title: "Fighting Spirit", records: ["aniwave:ippo-1", "hianime:ippo-1"], updatedAt: new Date().toISOString() };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("bounded Browse discovery", () => {
  it("parses provider responses, persists the discovered identity, and reopens it without network requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "browse-discovery-"));
    try {
      const store = new StateStore(join(directory, "state.json")); await store.load();
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input));
        const aniwave = url.origin === config.aniwaveBaseUrl;
        const query = aniwave ? url.searchParams.get("keyword") : JSON.parse(String(init?.body)).title;
        const found = query === "Fighting Spirit";
        return new Response(aniwave
          ? found ? '<div class="item"><a class="name d-title" href="/watch/hajime-no-ippo-78818" data-jp="Hajime no Ippo">Fighting Spirit</a></div>' : ""
          : JSON.stringify(found ? [{ English: "Fighting Spirit", Japanese: "Hajime no Ippo", slugs: ["fighting-spirit-72xozg"] }] : []), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const service = new BrowseDiscovery();
      const run = (works: Work[] = [], refresh = false) => catalogContext.run({ signal: new AbortController().signal, priority: 1, scope: directory, refresh },
        () => service.discover(anime, config, { works }));
      const result = await run();
      expect(result.anime?.sources?.map((source) => source.id).sort()).toEqual(["aniwave:hajime-no-ippo-78818", "hianime:fighting-spirit-72xozg"]);
      expect(fetchMock).toHaveBeenCalledTimes(6);
      expect(fetchMock.mock.calls.every(([url]) => String(url).includes("/filter?") || String(url) === "https://animehot.cc/api/search")).toBe(true);
      await store.recordBindings([result.anime!]);
      await store.load();
      fetchMock.mockClear();
      expect((await run(store.snapshot().works)).anime?.sources).toHaveLength(2);
      expect(fetchMock).not.toHaveBeenCalled();
      // A cold identity can reuse HTTP responses; an explicit retry bypasses both kinds of cache.
      expect((await run()).anime?.sources).toHaveLength(2);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await run(store.snapshot().works, true)).anime?.sources).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(6);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("finds the original Ippo from a cold start on both sources, without searching AniList", async () => {
    // These are the titles and empty/nonempty queries observed in the live investigation.
    const search = vi.fn<typeof searchOne>(async (query, provider) => query === "Fighting Spirit" ? [hit(provider)] : []);
    const result = await new BrowseDiscovery(search).discover(anime, config);
    expect(result.anime).toMatchObject({ title: "Fighting Spirit", refs: anime.refs });
    expect(result.anime?.sources?.map((source) => source.provider).sort()).toEqual(["aniwave", "hianime"]);
    for (const provider of ["aniwave", "hianime"]) expect(search.mock.calls.filter((call) => call[1] === provider).map((call) => call[0]))
      .toEqual([anime.title, "The First Step", "Fighting Spirit"]);
    expect(result.errors).toEqual({});
  });

  it.each([
    { title: "Hajime No Ippo: The Fighting! - Rising -", names: ["Hajime no Ippo: Rising", "はじめの一歩 Rising", "Hajime no Ippo 3", "Fighting Spirit: Rising"], alias: "Fighting Spirit: Rising", count: 4 },
    { title: "Hajime no Ippo: The Fighting! New Challenger", names: ["Hajime no Ippo: New Challenger", "はじめの一歩 New Challenger", "Hajime no Ippo Season II", "Hajime no Ippo 2", "Fighting Spirit: New Challenger"], alias: "Fighting Spirit: New Challenger", count: 5 }
  ])("reaches the fallback alias for $alias", async ({ title, names, alias, count }) => {
    const search = vi.fn<typeof searchOne>(async (query, provider) => query === alias ? [hit(provider, alias)] : []);
    const result = await new BrowseDiscovery(search).discover({ ...anime, title, titles: [title, ...names] }, config);
    expect(result.anime?.title).toBe(alias);
    expect(search).toHaveBeenCalledTimes(count * 2);
  });

  it("caps each enabled provider independently at five queries and skips disabled providers", async () => {
    const search = vi.fn<typeof searchOne>().mockResolvedValue([]);
    expect(await new BrowseDiscovery(search).discover(anime, config)).toEqual({ errors: {} });
    expect(search).toHaveBeenCalledTimes(BROWSE_QUERY_LIMIT * 2);
    expect(search.mock.calls.some((call) => call[1] === "anidb")).toBe(false);
    for (const provider of ["aniwave", "hianime"]) expect(new Set(search.mock.calls.filter((call) => call[1] === provider).map((call) => call[0])).size).toBe(5);
    search.mockClear();
    await new BrowseDiscovery(search).discover(anime, { ...config, disabledSources: ["aniwave", "hianime", "anidb"] });
    expect(search).not.toHaveBeenCalled();
  });

  it("stops a matched source immediately while allowing another to reach its fallback", async () => {
    const search = vi.fn<typeof searchOne>(async (query, provider) => provider === "aniwave" || query === "Fighting Spirit" ? [hit(provider)] : []);
    await new BrowseDiscovery(search).discover(anime, config);
    expect(search.mock.calls.filter((call) => call[1] === "aniwave")).toHaveLength(1);
    expect(search.mock.calls.filter((call) => call[1] === "hianime")).toHaveLength(3);
  });

  it("uses exact-ID offline hints as retrieval queries without trusting their aliases as identity", async () => {
    const hints = [{ refs: anime.refs, title: "Hajime no Ippo", titles: ["Hajime no Ippo", "Bad Index Alias"] }];
    const search = vi.fn<typeof searchOne>(async (query, provider) => query === "Hajime no Ippo" ? [hit(provider)] : []);
    expect((await new BrowseDiscovery(search).discover(anime, config, { hints })).anime?.title).toBe("Fighting Spirit");
    expect(search.mock.calls.filter((call) => call[1] === "aniwave").map((call) => call[0])).toEqual([anime.title, "Hajime no Ippo"]);
    search.mockImplementation(async (_query, provider) => [hit(provider, "Bad Index Alias")]);
    expect((await new BrowseDiscovery(search).discover(anime, config, { hints })).anime).toBeUndefined();
  });

  it("rejects wrong IDs, wrong years/formats, and ambiguous same-source matches", async () => {
    const wrong = [hit("aniwave", "Fighting Spirit", { refs: ["anilist:999"] }),
      { ...hit("aniwave"), sources: [{ ...hit("aniwave").sources![0], year: 2001 }] },
      { ...hit("aniwave"), sources: [{ ...hit("aniwave").sources![0], type: "MOVIE" as const }] }];
    for (const row of wrong) {
      const search = vi.fn<typeof searchOne>().mockResolvedValue([row]);
      expect((await new BrowseDiscovery(search).discover(anime, { ...config, disabledSources: ["anidb", "hianime"] })).anime).toBeUndefined();
    }
    const two = [hit("aniwave"), { id: "aniwave:other-2", provider: "aniwave" as const, title: "Fighting Spirit" }];
    expect((await new BrowseDiscovery(vi.fn<typeof searchOne>().mockResolvedValue(two)).discover(anime, config)).anime).toBeUndefined();
  });

  it("ignores partial episode totals and accepts a shared ID despite catalogue year disagreement", async () => {
    const partial = { ...hit("aniwave"), sources: [{ ...hit("aniwave").sources![0], episodes: 10 }] };
    const referenced = hit("hianime", "Unrelated display name", { refs: anime.refs, sources: [{ ...hit("hianime").sources![0], year: 2001 }] });
    const search = vi.fn<typeof searchOne>(async (_query, provider) => [provider === "aniwave" ? partial : referenced]);
    expect((await new BrowseDiscovery(search).discover(anime, config)).anime?.sources).toHaveLength(2);
  });

  it("reuses remembered source IDs and only searches sources still missing", async () => {
    const search = vi.fn<typeof searchOne>().mockResolvedValue([]);
    expect((await new BrowseDiscovery(search).discover(anime, config, { works: [work] })).anime?.sources).toHaveLength(2);
    expect(search).not.toHaveBeenCalled();
    await new BrowseDiscovery(search).discover(anime, config, { works: [{ ...work, records: ["aniwave:ippo-1"] }] });
    expect(search.mock.calls.map((call) => call[1])).toEqual(Array(5).fill("hianime"));
  });

  it("explicit retry bypasses remembered links and starts a fresh bounded attempt", async () => {
    const search = vi.fn<typeof searchOne>().mockResolvedValue([]);
    expect((await new BrowseDiscovery(search).discover(anime, config, { works: [work], refresh: true })).anime).toBeUndefined();
    expect(search).toHaveBeenCalledTimes(10);
  });

  it("stops an unavailable source after its first failure and retains working results", async () => {
    const search = vi.fn<typeof searchOne>(async (query, provider) => {
      if (provider === "aniwave") throw new Error("429 Retry-After");
      return query === "Fighting Spirit" ? [hit(provider)] : [];
    });
    const result = await new BrowseDiscovery(search).discover(anime, config);
    expect(result.errors).toEqual({ aniwave: "429 Retry-After" });
    expect(result.anime?.provider).toBe("hianime");
    expect(search.mock.calls.filter((call) => call[1] === "aniwave")).toHaveLength(1);
  });

  it("reports all-source failures separately from a successful empty search", async () => {
    const search = vi.fn<typeof searchOne>().mockRejectedValue(new Error("offline"));
    expect(await new BrowseDiscovery(search).discover(anime, config)).toEqual({ errors: { aniwave: "offline", hianime: "offline" } });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("enforces one overall deadline, aborts outstanding searches, and keeps already matched sources", async () => {
    vi.useFakeTimers();
    let outstanding: AbortSignal | undefined;
    const search = vi.fn<typeof searchOne>(async (_query, provider) => {
      if (provider === "aniwave") return [hit(provider)];
      outstanding = catalogContext.getStore()!.signal;
      return new Promise(() => {});
    });
    const pending = new BrowseDiscovery(search).discover(anime, config);
    await tick(); await vi.advanceTimersByTimeAsync(BROWSE_DISCOVERY_MS);
    const result = await pending;
    expect(result.anime?.provider).toBe("aniwave");
    expect(result.errors.hianime).toMatch(/timed out/);
    expect(outstanding?.aborted).toBe(true);
    expect(search).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reset the deadline for each alias or report a timeout as an empty match", async () => {
    vi.useFakeTimers();
    const search = vi.fn<typeof searchOne>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 8_000)); return [];
    });
    const pending = new BrowseDiscovery(search).discover(anime, config);
    await vi.advanceTimersByTimeAsync(BROWSE_DISCOVERY_MS);
    expect(await pending).toEqual({ errors: { aniwave: expect.stringMatching(/timed out/), hianime: expect.stringMatching(/timed out/) } });
    expect(search).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(search).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours Retry-After and performs no alias retries against a rate-limited source", async () => {
    const limitedConfig = { ...config, aniwaveBaseUrl: "https://browse-limited.test", disabledSources: ["anidb", "hianime"] as ProviderName[] };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new BrowseDiscovery();
    const first = await service.discover(anime, limitedConfig);
    expect(first.errors.aniwave).toContain("429");
    const retry = await catalogContext.run({ signal: new AbortController().signal, priority: 1, scope: "limited-retry", refresh: true, recoveryChecks: new Set() },
      () => service.discover(anime, limitedConfig));
    expect(retry.errors.aniwave).toContain("Source asked us to wait");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels immediately and ignores results arriving after navigation", async () => {
    const controller = new AbortController();
    let finish!: (rows: AnimeResult[]) => void;
    const search = vi.fn<typeof searchOne>(() => new Promise((resolve) => { finish = resolve; }));
    const pending = catalogContext.run({ signal: controller.signal, priority: 1, scope: "cancel-test" }, () => new BrowseDiscovery(search).discover(anime, { ...config, disabledSources: ["anidb", "hianime"] }));
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    finish([hit("aniwave")]); await tick();
    expect(search).toHaveBeenCalledOnce();
    await expect(catalogContext.run({ signal: controller.signal, priority: 1, scope: "cancel-test" }, () => new BrowseDiscovery(search).discover(anime, config))).rejects.toMatchObject({ name: "AbortError" });
    expect(search).toHaveBeenCalledOnce();
  });

  it("counts actual HTTP retries, stays within ten requests per source, and makes no metadata requests", async () => {
    vi.useFakeTimers();
    let requests = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("", { status: ++requests % 2 ? 503 : 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new BrowseDiscovery().discover(anime, { ...config, disabledSources: ["anidb", "hianime"] });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ errors: {} });
    expect(fetchMock).toHaveBeenCalledTimes(BROWSE_HTTP_LIMIT);
    expect(new Set(fetchMock.mock.calls.map(([url]) => String(url))).size).toBe(5);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith(config.aniwaveBaseUrl + "/filter?keyword="))).toBe(true);
  });

  it("checks the transport allowance before retrying a request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = catalogContext.run({ signal: new AbortController().signal, priority: 1, scope: "one-http-request", searchRequestBudget: { remaining: 1 } },
      () => searchOne("test", "aniwave", config));
    const rejected = expect(pending).rejects.toThrow("budget exhausted");
    await vi.advanceTimersByTimeAsync(1_000); await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

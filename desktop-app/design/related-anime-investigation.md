# Related anime: source availability investigation

> **Status (16 September 2026): feature removed.** The verified related-titles feature described below was built, then dropped the same day: verifying each relation against every enabled source cost dozens of provider requests per series page for a shortcut a search already covers. The complete implementation (service, hook, grouped UI, tests, One Piece dev fixture) is parked on branch `wip/related-anime`. AniList relations still arrive with the work information; nothing displays them. A future attempt should start from installments only, verified on click. The two general fixes from this work stayed: AniWave search facts are read within each card, and identity matching rejects conflicting catalogue ids.

Date: 16 September 2026 (Australia/Brisbane)

Status: investigation followed by implementation on 16 September 2026. The sections below preserve the findings and original proposal; the implementation summary is at the end.

## Conclusion

The related-anime UI currently displays AniList relationships without establishing that the linked anime can be retrieved from an enabled source. Clicking a relationship starts an ordinary text search and loses the identity information already attached to the relationship. This affects every series using this component.

The proposed display requirement is:

> A related suggestion must resolve to a specific, sufficiently verified anime record on an enabled source, and that source must successfully return at least one episode. Clicking the suggestion opens those verified source records directly.

Unknown, ambiguous, empty, failed, and expired results stay out of the suggestions. A metadata record, search hit, advertised episode total, or old library binding alone does not satisfy this requirement.

This establishes catalogue and episode availability at the time checked. Playback still depends on the selected audio track, supported video host, and stream retrieval. Guaranteeing a playable stream would require a separate, more expensive validation step. The suggested first implementation checks source identity and episode retrieval; its UI should avoid promising guaranteed playback.

## Scope and evidence

- Reviewed the AniList client, work-information cache, identity index, matching/grouping helpers, provider search and episode parsers, request scheduler, IPC, series navigation, and relevant tests.
- Inspected the existing local metadata cache: 14 works, all with relationships, containing 102 relationship entries and 100 distinct related AniList IDs.
- Ran 58 searches for 12 representative related entries across the two enabled sources, AniWave and HiAnime, using the current source adapters. Used up to three distinct titles per entry/source in that initial sample.
- Ran another 10 targeted searches to investigate alternate titles and split releases, and fetched episode lists for matches and saved JoJo source IDs.
- Read three current AniList records directly by ID to clarify aliases and the Re:ZERO bundle.
- Compiled the current Electron/shared source into a temporary directory for these read-only probes.
- Ran six existing test files: 106 tests passed. Also ran isolated reproductions of matching and parser edge cases against the compiled current code.

The sample is intentionally varied, rather than a census of every relationship. A successful episode fetch is positive evidence. An empty search establishes only that the attempted query did not find a record. Additional aliases, pages, source changes, or parser changes can affect that result. AniDB was disabled in the user's settings and was excluded from live requests; its adapter was reviewed in code.

The search palette currently passes `auto`, so it searches all enabled sources. The saved preferred-provider setting does not restrict these related-title searches. An early hypothesis about that setting was ruled out by inspecting `App.tsx:82`.

## Concrete examples

| Related entry | Observed result | Consequence |
| --- | --- | --- |
| Tanya: the Movie | The displayed English title returned zero AniWave hits. `Youjo Senki Movie` found a record with one episode. HiAnime also returned movie records with one episode. | Preserve aliases and open the resolved movie directly. |
| Youjo Shenki 2 | Zero hits on both enabled sources. Searching `Youjo Shenki` found the first mini-series on AniWave, with 12 episodes. | Hide the unverified second series. Preserve season numbers when broadening a query. |
| JoJo: Stardust Crusaders, Battle in Egypt | The displayed title and initially attempted aliases returned zero hits. The app already had three source IDs linked to AniList 20799; all three returned 24 episodes. | Reuse and revalidate saved IDs before searching. The current click path ignores usable records already known to the app. |
| Jujutsu Kaisen: Execution | The long displayed title returned zero hits. `JUJUTSU KAISEN: Execution` found HiAnime record `mal:62392`, with one episode. | Rank useful shorter aliases; a three-query budget spent on long transliterations can miss a valid record. |
| Frieren: ●● no Mahou | The displayed Japanese title worked on AniWave, returning 23 episodes. HiAnime required `Frieren: Beyond Journey's End Mini Anime`, returning 24 episodes. | Query titles appropriate to each source. Available episode counts can legitimately differ. |
| Frieren: The Brave / Sunny | Searches returned other anime, including Scum of the Brave and Naruto/Fate specials. No identity-matched record was verified in the sample. | A nonempty search result is insufficient. Generic titles can create misleading or wrong destinations. |
| Re:ZERO OVAs | The aggregate title returned zero hits. Memory Snow and The Frozen Bond each returned a separate HiAnime movie with one episode. | Represent individual source releases carefully; an aggregate and one component are different scopes. |
| Thus Spoke Rohan Kishibe | AniWave returned `Thus Spoke Kishibe Rohan`, with four episodes. | Preserve source titles and aliases while matching canonical identity. |
| One Piece Film: Gold | AniWave returned the movie and one episode. | Retain ordinary successful relationships through the same validation path. |
| LA Lakers × One Piece / Jujutsu Kaisen: Shimetsu Kaiyuu - Kouhen | No matches in the bounded searches on either enabled source. | Keep these out until a source record is verified. |

The Re:ZERO case deserves special treatment: the current AniList record 100049 describes two episodes, Memory Snow and The Frozen Bond, and also supplies MAL 36286. HiAnime uses MAL 36286 for Memory Snow alone and MAL 38414 for The Frozen Bond. Even a shared external ID can refer to records with different coverage across catalogues. An alias list also contains component titles, so aliases alone cannot establish that a source contains the entire bundle.

## How the problem arises

### 1. Metadata becomes clickable UI without validation

`electron/anilist.ts:19` requests relation IDs, names, format, and relation type. `toWorkInfo()` at line 118 accepts every anime relationship with an ID and title. It chooses one display title and discards the other title variant. Relation status, year, and synonyms are absent from this query/model.

`src/SeriesScreen.tsx:44` sorts all of those entries. At line 106 it renders every entry as a button calling `onSearch(relation.title)`. `src/App.tsx:561` forwards that title into the ordinary search palette. No source ID, identity constraint, or episode evidence accompanies the action.

The same path includes music videos, advertisements, character crossovers, recaps, specials, future releases, and movies. The local cache contains four music entries and 15 `character` relationships. ONE PIECE alone contributes 61 relations. These are catalogue associations, with varying usefulness as watch suggestions.

### 2. Search discovery and identity matching are separate problems

`CatalogService.search()` searches the literal query on providers. AniList and the offline index help identify/group rows that providers return; they do not automatically issue alternate provider searches when that query returns nothing.

`resolveSource()` does try aliases, but it is used when resolving additional providers for an already selected source-backed anime. Related-title buttons never invoke it for their target. It also takes the first three raw titles and returns the first exact match, or first likely match, so reusing it unchanged would preserve ambiguity and alias-selection problems.

The index keeps at most 15 synonyms in input order. In the sampled JoJo record, several non-English or abbreviated aliases precede useful provider spellings. The shorter Execution title was beyond the initial three attempted titles. Alias ordering needs an explicit query policy.

The provider adapters perform one search request each; the AniWave adapter does not follow search pagination. Broadening to a franchise title can therefore miss a later result page. The ordinary catalogue search rejects queries longer than 120 characters, while metadata titles can be longer; no overlength relationship occurred in this cache sample.

### 3. Current identity helpers need stronger safeguards

Isolated reproductions confirmed:

- `sourceMatch()` returns `exact` for identical titles carrying conflicting MAL IDs, because the title fallback never rejects those reference conflicts.
- A shared reference returns `exact` before checking format or coverage. This matters for the real Re:ZERO aggregate/component example.
- `bestCandidate()` rejects an otherwise identical ongoing series with three currently available episodes against a planned total of 12. Its episode-count heuristic mixes current availability with total work length.
- `resolveSource()` can accept the first matching hit without proving that another result is a distinct competing match.

These are reasons to introduce a dedicated, conservative relation-to-source resolver, with shared improvements where appropriate. Adding the desired AniList ID to a candidate before matching would manufacture its own evidence and must be avoided.

### 4. Provider data can look empty or carry incorrect facts

`parseHiAnimeSearch()` returns an empty list for an unexpected response object. The AniWave parser likewise returns an empty list for a challenge/error HTML page with no matching cards. A new resolver must distinguish a valid no-results response from an unrecognized response.

The AniWave parser extracts facts from the 900 characters preceding each title anchor, rather than from the containing card. A two-card reproduction showed the second TV series inheriting the first movie's format, episode count, and poster. This can incorrectly reject or accept identity matches. Fix card boundaries before treating these fields as strong validation evidence.

These parser issues were reproduced with controlled inputs. They were not established as the cause of the live zero-result examples.

### 5. Existing cache lifetimes describe different kinds of freshness

Work metadata refreshes after 90 days for static entries and one day for ongoing/upcoming entries. That policy cannot establish source availability. `CatalogService.availableEpisodeCount()` can reuse a seven-day episode cache, which is also too old to prove current fetchability.

Provider response bodies already have shorter lifetimes: searches approximately 60 seconds, episode responses 30 seconds. The shared request scheduler handles cancellation, request coalescing, host limits, priorities, and backoff. These mechanisms should support the new resolver.

Availability must be scoped to source addresses and the enabled source set. `sourceSettingsKey()` already expresses that combination. The current work-info hook has different scope semantics and only cancels on scope changes; a separate related-results hook should explicitly cancel when leaving or changing series and reject late responses by generation.

## Proposed implementation

### A. Separate metadata relationships from verified suggestions

Keep raw `WorkInfo.relations` as metadata. Add a separate result model for verified suggestions, containing:

- The target relation and canonical references.
- The actual source-backed `AnimeResult`, including verified source IDs and source titles.
- Per-source verification time and nonempty episode-list evidence.
- Match evidence and internal unresolved reasons for diagnostics.

Use a dedicated main-process service/IPC operation and renderer hook. Resolve targets from the current series' metadata in the main process. Validate IPC inputs and enforce request budgets there.

Internal outcomes should distinguish available, no match within the search budget, ambiguous identity, no episodes, unsupported response, network error, and cancellation. Only available results enter the suggestion list. If every check fails, the section can explain that related titles could not be checked without displaying unverified title buttons.

### B. Resolve identity before testing availability

1. Look up existing works by target references and use their enabled source IDs as leads. Revalidate the source details and coverage; saved links can be stale or incorrectly bound.
2. Enrich the target using cached metadata/index information or an exact-ID metadata lookup. Retain English, romanized/native names, useful synonyms, format, year, and release status.
3. Search ranked, deduplicated title variants on enabled providers. Prefer known successful source titles, then useful English/romanized aliases. Keep distinctive season/part/movie qualifiers. Avoid blind truncation or deleting qualifiers to force a match.
4. Compare individual returned records against target evidence. Reject conflicting IDs and unresolved competing identities. Use source detail endpoints to clarify ambiguous search cards when supported.
5. Treat related bundles and component releases explicitly. Initially hide unresolved aggregate relationships. Add separate verified component suggestions only when their relationship and coverage can be established, keeping their own identities. This is safer than assigning an aggregate's identity and totals to every component.
6. Fetch the actual episode list for a confirmed record. At least one valid episode from one enabled source is required. Advertised counts and search cards alone are insufficient.

Source-detail parsing should expose identity fields where available. HiAnime already uses the same anime endpoint for detail information and episode lists, allowing response reuse. AniWave's tooltip/watch information and AniDB's anime details require their provider-specific parsing.

Identity facts need provenance: source-stated IDs, persisted inferred links, planned totals, available counts, and known aggregate/component mappings have different meanings. A strict matcher should evaluate conflicting evidence rather than treating any one shared ID as unconditional proof.

### C. Open the verified record directly

Replace the related-button text-search callback with navigation through `openAnime(verifiedAnime)`. Preserve the verified source IDs. Apply the strengthened matching rules to any later cross-source resolution too.

Show format and a clear relationship label. “Previous in story” or “Previous installment” is less likely to be read as “previous TV season.” Keep a movie's genuine relationship. Earlier TV seasons can be discovered separately by traversing prequel links with a visited-ID set and depth/node limits, then validating each destination through the same source gate. Do not infer season numbering from title text or fabricate a direct edge across missing entries.

### D. Keep validation fresh and bounded

- Perform validation for the selected series, with prequel/sequel candidates first. Publish confirmed suggestions progressively.
- Use a bounded worker pool and the existing scheduler, below playback and current episode-list requests. Cancel on navigation or settings changes.
- Start with a small batch and explicit limits on query variants, candidate details, and relationship traversal. ONE PIECE's 61 entries would otherwise produce up to 366 searches for three queries across two providers, before episode checks.
- Cache discovery mappings separately from availability evidence. A known source ID can remain a useful lead after its availability proof expires.
- Reuse only fresh episode checks, initially the existing approximately 30-second response-cache window. Expired suggestions remain hidden while revalidation runs. A later longer TTL would be an explicit freshness tradeoff.
- Keep successful no-match outcomes briefly, for example five minutes; keep errors separate and follow host backoff. A timeout must never become a permanent “unavailable” classification.
- Key by target identity, source addresses, enabled providers, matching-policy version, and relevant binding/metadata revision. Invalidate upon source changes, manual splits/merges, and refresh. If audio-specific verification is added, include audio mode.
- A refresh must recheck related availability as well as metadata. A failed refresh must not silently turn stale episode evidence into a fresh suggestion.
- For oversized franchises, request subsequent validation batches on demand. Only already verified entries appear as suggestions.

## Suggested implementation order

1. Repair the parser/identity safeguards needed for reliable matching, with focused regressions.
2. Add the relation resolver, evidence model, freshness rules, and cancellation.
3. Switch the UI to verified suggestions and direct navigation; retain existing metadata display separately.
4. Add bounded earlier-installment discovery and explicit bundle/component support after the source gate works.

The first three steps address the dead-end suggestions. The fourth improves franchise navigation and recovery of valid entries whose catalogue structures differ. Conservative matching may initially hide some available anime; diagnostics and targeted aliases/mappings can improve recall while keeping false suggestions low.

## Required regression coverage

- An unverified AniList relation never appears, including during initial load or a cache update.
- Tanya's English-title miss resolves through its romanized alias and opens the verified movie.
- Youjo Shenki 2 stays hidden; a broader search finding Youjo Shenki does not substitute season one.
- JoJo opens verified saved source IDs even when title searches fail.
- Execution resolves using its shorter alias on the enabled source that carries it.
- Generic titles with unrelated search hits remain hidden.
- Conflicting same-namespace IDs, duplicate title ambiguity, wrong seasons, remakes, formats, and parts are handled conservatively.
- Re:ZERO's two-episode bundle is not equated to either one-episode movie merely through shared IDs or aliases.
- Ongoing available counts do not incorrectly veto identity against announced totals.
- Positive search hits with empty/failed episode lists stay hidden; a successful alternative source can still qualify.
- Invalid response shapes and challenge pages become errors, distinct from valid empty searches.
- Adjacent AniWave cards retain their own format, episode count, and artwork.
- Disabled/changed sources, expired evidence, failed refreshes, cancellation, and late results cannot expose obsolete suggestions.
- Multiple related queries share bounded provider requests and respect playback priority.
- Earlier-installment traversal terminates on cycles and branches without inventing relationships.

## Verification performed

`npm test -- tests/anilist.test.ts tests/work-info-service.test.ts tests/catalog.test.ts tests/catalog-service.test.ts tests/scraper.test.ts tests/search.test.tsx`

Result: 6 files passed, 106 tests passed. Current Electron/shared TypeScript compilation also passed into a temporary output directory. The existing UI test explicitly expects the old behavior of searching for a relation's display title; it will need to assert direct navigation to verified source records instead.

During the investigation phase, application code, library bindings, settings, and application caches were unchanged. The repository addition is this report. Live probes used separate temporary files and fresh service instances.


## Implementation and verification

Implemented the source gate in `electron/related-anime-service.ts` and direct navigation from `SeriesScreen`. Raw metadata relations never become navigation buttons. Verification uses source identity, nonempty episode lists, alternate titles, saved IDs, conflicting-ID and coverage checks, and ambiguity rejection. Source-disabled settings and manual splits are respected. The AniWave card parser now reads facts within the current card, and strict related searches distinguish recognized empty pages from unsupported responses.

Requests process eight relations per batch, with two relation workers. Additional batches require **More related titles**. A bounded prequel traversal exposes earlier installments through movies and specials. Positive evidence expires after 30 seconds; the renderer removes expired entries, rechecks while the series is open, and cancels requests on navigation or configuration changes. Unresolved bundles are hidden until a reliable component mapping exists.

Validation: all 335 tests across 40 files passed, TypeScript checks and the production build passed, plus live source checks for Tanya, JoJo, Jujutsu Kaisen, and Re:ZERO. Tanya's unavailable second mini-series stayed hidden; its movie and first season resolved. JoJo's saved source IDs worked. Execution resolved through its shorter title on HiAnime. The Re:ZERO aggregate remained hidden while independently verified relationships remained available.

An isolated offscreen Electron renderer test used the live Tanya result as a fixture, verified the three related buttons and absence of horizontal overflow, and confirmed that clicking the movie opened `aniwave:youjo-senki-movie-73148` directly. User library/settings files were not used as writable test fixtures. Stream playback was outside these catalogue checks.

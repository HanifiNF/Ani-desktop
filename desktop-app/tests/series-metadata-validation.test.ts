import { describe, expect, it } from "vitest";
import { validateSeriesMetadataRequest } from "../electron/series-metadata-validation";

describe("series metadata IPC validation", () => {
  it("accepts bounded native sources", () => {
    const anime = { id: "aniwave:show-1", title: "Show", provider: "aniwave" as const,
      sources: [{ id: "hianime:show-safe", title: "Show", provider: "hianime" as const, aliases: ["Show", "ショー"] }] };
    expect(validateSeriesMetadataRequest(anime)).toBe(anime);
  });

  it("rejects unknown providers, mismatched IDs, and unbounded aliases", () => {
    expect(() => validateSeriesMetadataRequest({ id: "evil:1", title: "Show", provider: "evil" })).toThrow("Invalid anime metadata request");
    expect(() => validateSeriesMetadataRequest({ id: "aniwave:show-1", title: "Show", provider: "aniwave", sources: [{ id: "anidb:show-1", title: "Show", provider: "aniwave", aliases: [] }] })).toThrow("Invalid anime metadata request");
    expect(() => validateSeriesMetadataRequest({ id: "aniwave:show-1", title: "Show", provider: "aniwave", sources: [{ id: "aniwave:show-1", title: "Show", provider: "aniwave", aliases: ["x".repeat(501)] }] })).toThrow("Invalid anime metadata request");
  });
});

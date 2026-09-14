import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "../shared/external-url";

describe("external application links", () => {
  it("allows validated HTTPS and email destinations", () => {
    expect(isAllowedExternalUrl("https://github.com/HanifiNF")).toBe(true);
    expect(isAllowedExternalUrl("mailto:hanifisetiawan@gmail.com")).toBe(true);
  });

  it("rejects navigation and malformed destinations", () => {
    expect(isAllowedExternalUrl("http://github.com/HanifiNF")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("mailto:not-an-address")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });
});

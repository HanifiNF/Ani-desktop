import { describe, expect, it } from "vitest";
import { DEFAULT_SUBTITLE_APPEARANCE, normalizeSubtitleAppearance, validateSubtitleAppearance } from "../shared/subtitle-appearance";
import { subtitleVariables } from "../src/SubtitleAppearanceEditor";

describe("subtitle appearance", () => {
  it("uses defaults for older or damaged saved values", () => {
    expect(normalizeSubtitleAppearance(undefined)).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
    expect(normalizeSubtitleAppearance({ ...DEFAULT_SUBTITLE_APPEARANCE, textColor: "url(javascript:x)" })).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
    const { backgroundEnabled: _mode, ...legacy } = DEFAULT_SUBTITLE_APPEARANCE;
    expect(normalizeSubtitleAppearance({ ...legacy, backgroundOpacity: 0 })).toMatchObject({ backgroundEnabled: false, backgroundOpacity: 70 });
    expect(normalizeSubtitleAppearance({ ...legacy, backgroundOpacity: 45 })).toMatchObject({ backgroundEnabled: true, backgroundOpacity: 45 });
  });

  it("accepts bounded values and rejects invalid IPC input", () => {
    const value = { ...DEFAULT_SUBTITLE_APPEARANCE, size: 200, bottomInset: 20, backgroundOpacity: 100, textColor: "#A1b2C3" };
    expect(validateSubtitleAppearance(value)).toEqual(value);
    for (const bad of [
      { ...value, size: 55 }, { ...value, bottomInset: 21 }, { ...value, backgroundOpacity: -1 },
      { ...value, font: "custom" }, { ...value, edge: "glow" }, { ...value, backgroundColor: "red" },
      { ...value, backgroundEnabled: "none" }, { ...value, backgroundOpacity: 0 }
    ]) expect(() => validateSubtitleAppearance(bad)).toThrow();
  });

  it("maps saved values to preview and player CSS variables", () => {
    const vars = subtitleVariables({ ...DEFAULT_SUBTITLE_APPEARANCE, size: 150, bottomInset: 8, edge: "shadow" });
    expect(vars["--app-subtitle-size"]).toBe("1.5");
    expect(vars["--app-subtitle-bottom-inset"]).toBe("8%");
    expect(vars["--app-subtitle-shadow"]).toContain("2px 2px");
    expect(vars["--app-subtitle-background-resolved"]).toBe("transparent");
    expect(subtitleVariables({ ...DEFAULT_SUBTITLE_APPEARANCE, backgroundEnabled: true, backgroundColor: "#123456", backgroundOpacity: 45 })["--app-subtitle-background-resolved"])
      .toBe("color-mix(in srgb, #123456 45%, transparent)");
  });
});

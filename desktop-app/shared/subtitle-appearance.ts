import type { SubtitleAppearance } from "./contracts";

export const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearance = {
  font: "sans", size: 100, textColor: "#ffffff", backgroundColor: "#000000",
  backgroundEnabled: false, backgroundOpacity: 70, edge: "outline", bottomInset: 0
};

export function validateSubtitleAppearance(value: unknown): SubtitleAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid subtitle appearance");
  const item = value as Record<string, unknown>;
  if (!["sans", "serif", "mono"].includes(String(item.font))) throw new Error("Invalid subtitle font");
  if (!Number.isInteger(item.size) || (item.size as number) < 50 || (item.size as number) > 200 || (item.size as number) % 10 !== 0) throw new Error("Invalid subtitle size");
  for (const key of ["textColor", "backgroundColor"] as const) {
    if (typeof item[key] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(item[key])) throw new Error("Invalid subtitle color");
  }
  if (typeof item.backgroundEnabled !== "boolean") throw new Error("Invalid subtitle background mode");
  if (!Number.isInteger(item.backgroundOpacity) || (item.backgroundOpacity as number) < 1 || (item.backgroundOpacity as number) > 100) throw new Error("Invalid subtitle background opacity");
  if (!["none", "outline", "shadow"].includes(String(item.edge))) throw new Error("Invalid subtitle edge");
  if (!Number.isInteger(item.bottomInset) || (item.bottomInset as number) < 0 || (item.bottomInset as number) > 20) throw new Error("Invalid subtitle position");
  return {
    font: item.font as SubtitleAppearance["font"], size: item.size as number,
    textColor: item.textColor as string, backgroundEnabled: item.backgroundEnabled, backgroundColor: item.backgroundColor as string,
    backgroundOpacity: item.backgroundOpacity as number, edge: item.edge as SubtitleAppearance["edge"],
    bottomInset: item.bottomInset as number
  };
}

export function normalizeSubtitleAppearance(value: unknown): SubtitleAppearance {
  try {
    if (value && typeof value === "object" && !Array.isArray(value) && !("backgroundEnabled" in value)) {
      const legacy = value as Record<string, unknown>;
      return validateSubtitleAppearance({
        ...legacy,
        backgroundEnabled: typeof legacy.backgroundOpacity === "number" && legacy.backgroundOpacity > 0,
        backgroundOpacity: legacy.backgroundOpacity === 0 ? DEFAULT_SUBTITLE_APPEARANCE.backgroundOpacity : legacy.backgroundOpacity
      });
    }
    return validateSubtitleAppearance(value);
  }
  catch { return { ...DEFAULT_SUBTITLE_APPEARANCE }; }
}

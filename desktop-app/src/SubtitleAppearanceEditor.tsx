import type { SubtitleAppearance } from "../shared/contracts";
import { DEFAULT_SUBTITLE_APPEARANCE } from "../shared/subtitle-appearance";
import "./subtitle-appearance.css";

export function subtitleVariables(value: SubtitleAppearance): Record<`--${string}`, string> {
  const family = value.font === "serif" ? "Georgia, serif" : value.font === "mono" ? "Consolas, monospace" : "Arial, sans-serif";
  const shadow = value.edge === "outline"
    ? "-1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000, 1px 1px 1px #000"
    : value.edge === "shadow" ? "2px 2px 3px #000" : "none";
  return {
    "--app-subtitle-font": family,
    "--app-subtitle-size": String(value.size / 100),
    "--app-subtitle-color": value.textColor,
    "--app-subtitle-background": value.backgroundColor,
    "--app-subtitle-opacity": `${value.backgroundOpacity}%`,
    "--app-subtitle-background-resolved": value.backgroundEnabled
      ? `color-mix(in srgb, ${value.backgroundColor} ${value.backgroundOpacity}%, transparent)` : "transparent",
    "--app-subtitle-shadow": shadow,
    "--app-subtitle-bottom-inset": `${value.bottomInset}%`
  };
}

export function SubtitleAppearanceEditor({ value, onChange, noTrack = false }: {
  value: SubtitleAppearance;
  onChange: (value: SubtitleAppearance) => void;
  noTrack?: boolean;
}) {
  const update = <K extends keyof SubtitleAppearance>(key: K, next: SubtitleAppearance[K]) => onChange({ ...value, [key]: next });
  return <div className="subtitle-editor">
    {noTrack && <p className="subtitle-help">No separate subtitle track was supplied with this stream. If captions become available, this preset will apply. Subtitles burned into the picture cannot be customized.</p>}
    <div className="subtitle-preview" style={subtitleVariables(value) as React.CSSProperties} aria-label="Subtitle appearance preview">
      <span className="subtitle-sample">Sample subtitle · 字幕<br />Second line of text</span>
    </div>
    <div className="subtitle-fields">
      <label className="subtitle-field"><span>Font</span><select value={value.font} onChange={(event) => update("font", event.target.value as SubtitleAppearance["font"])}>
        <option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option>
      </select></label>
      <label className="subtitle-field"><span>Size</span><span className="subtitle-range"><input type="range" min="50" max="200" step="10" value={value.size} onChange={(event) => update("size", Number(event.target.value))} /><output>{value.size}%</output></span></label>
      <label className="subtitle-field"><span>Text color</span><input type="color" value={value.textColor} onChange={(event) => update("textColor", event.target.value)} /></label>
      <div className="subtitle-background-group">
        <label className="subtitle-field subtitle-no-background"><span>Background</span><span className="subtitle-checkbox"><input type="checkbox" checked={!value.backgroundEnabled} onChange={(event) => update("backgroundEnabled", !event.currentTarget.checked)} />No background</span></label>
        <label className="subtitle-field" data-disabled={!value.backgroundEnabled}><span>Background color</span><input type="color" disabled={!value.backgroundEnabled} value={value.backgroundColor} onChange={(event) => update("backgroundColor", event.target.value)} /></label>
        <label className="subtitle-field" data-disabled={!value.backgroundEnabled}><span>Background opacity</span><span className="subtitle-range"><input type="range" min="1" max="100" step="1" disabled={!value.backgroundEnabled} value={value.backgroundOpacity} onChange={(event) => update("backgroundOpacity", Number(event.target.value))} /><output>{value.backgroundOpacity}%</output></span></label>
      </div>
      <label className="subtitle-field"><span>Text edge</span><select value={value.edge} onChange={(event) => update("edge", event.target.value as SubtitleAppearance["edge"])}>
        <option value="none">None</option><option value="outline">Outline</option><option value="shadow">Drop shadow</option>
      </select></label>
      <label className="subtitle-field"><span>Move up from bottom</span><span className="subtitle-range"><input type="range" min="0" max="20" step="1" value={value.bottomInset} onChange={(event) => update("bottomInset", Number(event.target.value))} /><output>{value.bottomInset}%</output></span></label>
    </div>
    <div className="subtitle-actions"><button type="button" className="btn small" onClick={() => onChange({ ...DEFAULT_SUBTITLE_APPEARANCE })}>Reset to defaults</button></div>
  </div>;
}

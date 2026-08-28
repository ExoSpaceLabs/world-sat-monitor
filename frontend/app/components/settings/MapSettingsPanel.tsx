import type {CSSProperties} from "react";
import {AUTO_ROTATION_MAX_ZOOM, ROTATION_DEGREES_PER_SECOND} from "../../domain/scene";
import type {Basemap, SceneOptions} from "../../domain/types";

const TIME_SCALES = [1, 10, 60, 360] as const;

type MapSettingsPanelProps = {
  basemap: Basemap;
  scene: SceneOptions;
  themeLandColor: string;
  themeWaterColor: string;
  timeScale: number;
  onBasemapChange: (next: Basemap) => void;
  onDebugChange: (enabled: boolean) => void;
  onEnvironmentChange: (enabled: boolean) => void;
  onShadowOpacityChange: (opacity: number) => void;
  onThemeLandColorChange: (color: string) => void;
  onThemeWaterColorChange: (color: string) => void;
  onTimeReset: () => void;
  onTimeScaleChange: (scale: number) => void;
  onReset: () => void;
  onClose: () => void;
};

export function MapSettingsPanel({
  basemap,
  scene,
  themeLandColor,
  themeWaterColor,
  timeScale,
  onBasemapChange,
  onDebugChange,
  onEnvironmentChange,
  onShadowOpacityChange,
  onThemeLandColorChange,
  onThemeWaterColorChange,
  onTimeReset,
  onTimeScaleChange,
  onReset,
  onClose,
}: MapSettingsPanelProps) {
  return (
    <aside className="settings-panel" aria-label="Map settings">
      <div className="settings-head">
        <div><small>DISPLAY CONTROL</small><h2>MAP SETTINGS</h2></div>
        <button onClick={onClose} aria-label="Close map settings">×</button>
      </div>
      <section>
        <h3>BASEMAP</h3>
        <div className="basemap-options">
          {(["dark", "street", "satellite"] as Basemap[]).map((mode) => (
            <button
              key={mode}
              className={basemap === mode ? "selected" : ""}
              onClick={() => onBasemapChange(mode)}
              aria-pressed={basemap === mode}
            >
              <i className={`basemap-swatch ${mode}`}/><span>{mode === "dark" ? "THEMED" : mode.toUpperCase()}</span>
            </button>
          ))}
        </div>
        {basemap === "dark" && (
          <div className="theme-color-controls" aria-label="Themed basemap colors">
            <label>
              <span><b>WATER</b><output>{themeWaterColor.toUpperCase()}</output></span>
              <div><input type="color" value={themeWaterColor} onChange={(event) => onThemeWaterColorChange(event.target.value)} aria-label="Themed water color"/><i style={{background: themeWaterColor}}/></div>
            </label>
            <label>
              <span><b>LAND</b><output>{themeLandColor.toUpperCase()}</output></span>
              <div><input type="color" value={themeLandColor} onChange={(event) => onThemeLandColorChange(event.target.value)} aria-label="Themed land color"/><i style={{background: themeLandColor}}/></div>
            </label>
          </div>
        )}
      </section>
      <section>
        <h3>SPACE ENVIRONMENT</h3>
        <div className="scene-options">
          <button
            className="scene-toggle"
            role="switch"
            aria-checked={scene.spaceEnvironment}
            onClick={() => onEnvironmentChange(!scene.spaceEnvironment)}
          >
            <span><b>SKY · SUN · NIGHT SHADOW</b><small>ONE UTC-LOCKED ENVIRONMENT</small></span>
            <i className={scene.spaceEnvironment ? "enabled" : ""}/>
          </button>
          <label className={`shadow-opacity ${scene.spaceEnvironment ? "" : "disabled"}`}>
            <span><b>SHADOW OPACITY</b><output>{Math.round(scene.shadowOpacity * 100)}%</output></span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(scene.shadowOpacity * 100)}
              disabled={!scene.spaceEnvironment}
              onChange={(event) => onShadowOpacityChange(Number(event.target.value) / 100)}
              aria-label="Night shadow opacity"
              style={{"--shadow-opacity": `${Math.round(scene.shadowOpacity * 100)}%`} as CSSProperties}
            />
          </label>
        </div>
      </section>
      <section>
        <h3>DEBUG</h3>
        <div className="scene-options">
          <button
            className="scene-toggle"
            role="switch"
            aria-checked={scene.debug}
            onClick={() => onDebugChange(!scene.debug)}
          >
            <span><b>SCENE TELEMETRY</b><small>UTC · SUN FRAME · LAYER STATUS</small></span>
            <i className={scene.debug ? "enabled" : ""}/>
          </button>
          {scene.debug && (
            <div className="debug-time-control">
              <span><b>SIMULATION SPEED</b><output>{timeScale}×</output></span>
              <div className="debug-speed-options">
                {TIME_SCALES.map((scale) => (
                  <button
                    key={scale}
                    className={timeScale === scale ? "selected" : ""}
                    aria-pressed={timeScale === scale}
                    onClick={() => onTimeScaleChange(scale)}
                  >
                    {scale}×
                  </button>
                ))}
              </div>
              <button className="debug-time-reset" onClick={onTimeReset}>RESET TO CURRENT UTC</button>
            </div>
          )}
        </div>
      </section>
      <div className="rotation-state">
        <span>PLANET ROTATION</span>
        <b>{(ROTATION_DEGREES_PER_SECOND * timeScale).toFixed(4)}°/S · CAMERA LOCK Z{AUTO_ROTATION_MAX_ZOOM}</b>
      </div>
      <button className="settings-reset" onClick={onReset}>RESET MAP SETTINGS</button>
    </aside>
  );
}

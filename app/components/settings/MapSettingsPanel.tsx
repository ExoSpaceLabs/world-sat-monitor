import {AUTO_ROTATION_MAX_ZOOM, ROTATION_DEGREES_PER_SECOND} from "../../domain/scene";
import type {Basemap, SceneOptions} from "../../domain/types";

type MapSettingsPanelProps = {
  basemap: Basemap;
  scene: SceneOptions;
  onBasemapChange: (next: Basemap) => void;
  onEnvironmentChange: (enabled: boolean) => void;
  onClose: () => void;
};

export function MapSettingsPanel({
  basemap,
  scene,
  onBasemapChange,
  onEnvironmentChange,
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
              <i className={`basemap-swatch ${mode}`}/><span>{mode.toUpperCase()}</span>
            </button>
          ))}
        </div>
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
        </div>
      </section>
      <div className="rotation-state">
        <span>PLANET ROTATION</span>
        <b>{ROTATION_DEGREES_PER_SECOND.toFixed(4)}°/S · CAMERA LOCK Z{AUTO_ROTATION_MAX_ZOOM}</b>
      </div>
    </aside>
  );
}

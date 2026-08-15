import {DEFAULT_APP_SETTINGS, type OrbitDisplaySettings, type OrbitTrackMode} from "../../domain/settings";

export const ORBIT_DISPLAY_CHANGE_EVENT = "worldsat:orbit-display-change";

type OrbitSettingsPanelProps = {
  settings: OrbitDisplaySettings;
  effectivePathResolution: number | null;
  onChange: (settings: OrbitDisplaySettings) => void;
  onReset: () => void;
  onClose: () => void;
};

function notifyOrbitDisplayChange(settings: OrbitDisplaySettings) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OrbitDisplaySettings>(ORBIT_DISPLAY_CHANGE_EVENT, {detail: settings}));
}

function RangeControl({
  label, detail, value, min, max, step, suffix, onChange,
}: {
  label: string;
  detail: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="sat-range-control">
      <span><b>{label}</b><output>{value}{suffix}</output></span>
      <small>{detail}</small>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function OrbitSettingsPanel({
  settings,
  effectivePathResolution,
  onChange,
  onReset,
  onClose,
}: OrbitSettingsPanelProps) {
  const commit = (next: OrbitDisplaySettings) => {
    notifyOrbitDisplayChange(next);
    onChange(next);
  };
  const updatePath = (patch: Partial<OrbitDisplaySettings["path"]>) =>
    commit({...settings, path: {...settings.path, ...patch}});
  const setTrackMode = (mode: OrbitTrackMode) => updatePath({mode});
  const reset = () => {
    notifyOrbitDisplayChange(DEFAULT_APP_SETTINGS.orbit);
    onReset();
  };

  return (
    <aside className="settings-panel orbit-settings-panel" aria-label="Orbit display settings">
      <div className="settings-head">
        <div><small>GLOBAL DISPLAY CONTROL</small><h2>ORBIT SETTINGS</h2></div>
        <button onClick={onClose} aria-label="Close orbit settings">×</button>
      </div>
      <section>
        <h3>TRACK DISPLAY</h3>
        <div className="scene-options">
          <button
            className="scene-toggle"
            role="switch"
            aria-checked={settings.path.enabled}
            onClick={() => updatePath({enabled: !settings.path.enabled})}
          >
            <span><b>DRAW ORBIT PATHS</b><small>APPLIES TO EVERY TRACKED SATELLITE</small></span>
            <i className={settings.path.enabled ? "enabled" : ""}/>
          </button>
          <button
            className="scene-toggle"
            role="switch"
            aria-checked={settings.direction_vector_enabled}
            onClick={() => commit({...settings, direction_vector_enabled: !settings.direction_vector_enabled})}
          >
            <span><b>DRAW DIRECTION VECTOR</b><small>SHOW CURRENT SATELLITE HEADING INDEPENDENTLY OF PATHS</small></span>
            <i className={settings.direction_vector_enabled ? "enabled" : ""}/>
          </button>
          <div className="track-mode-control" role="group" aria-label="Orbit track placement">
            <span><b>TRACK PLACEMENT</b><small>GROUND = NADIR PROJECTION · ORBIT = ACTUAL ALTITUDE</small></span>
            <div>
              <button className={settings.path.mode === "ground" ? "active" : ""} onClick={() => setTrackMode("ground")}>GROUND</button>
              <button className={settings.path.mode === "orbit" ? "active" : ""} onClick={() => setTrackMode("orbit")}>ORBIT</button>
            </div>
          </div>
          <RangeControl
            label="HISTORY"
            detail="Track shown before display UTC for every satellite"
            value={settings.path.history_minutes}
            min={0}
            max={1440}
            step={10}
            suffix=" min"
            onChange={(history_minutes) => updatePath({history_minutes})}
          />
          <RangeControl
            label="PREDICTION"
            detail="Future propagated track for every satellite, up to 14 days"
            value={settings.path.prediction_hours}
            min={0}
            max={336}
            step={1}
            suffix=" h"
            onChange={(prediction_hours) => updatePath({prediction_hours})}
          />
          <RangeControl
            label="REQUESTED PATH STEP"
            detail="Shared API sampling request; backend may decimate further"
            value={settings.path.resolution_seconds}
            min={10}
            max={600}
            step={10}
            suffix=" s"
            onChange={(resolution_seconds) => updatePath({resolution_seconds})}
          />
          <div className="sat-setting-readout">
            <span>EFFECTIVE PATH STEP</span>
            <b>{effectivePathResolution ? `${effectivePathResolution} s` : "--"}</b>
          </div>
        </div>
      </section>
      <section>
        <h3>UPDATES</h3>
        <div className="scene-options">
          <RangeControl
            label="POSITION INTERPOLATION UPDATE"
            detail="Shared cadence used when requesting interpolated positions"
            value={settings.position_update_ms}
            min={100}
            max={5000}
            step={100}
            suffix=" ms"
            onChange={(position_update_ms) => commit({...settings, position_update_ms})}
          />
          <RangeControl
            label="PATH REFRESH"
            detail="Shared cadence for re-querying history/prediction windows"
            value={settings.path.refresh_seconds}
            min={5}
            max={600}
            step={5}
            suffix=" s"
            onChange={(refresh_seconds) => updatePath({refresh_seconds})}
          />
        </div>
      </section>
      <div className="rotation-state"><span>PERSISTENCE</span><b>/data/settings.json</b></div>
      <button className="settings-reset" onClick={reset}>RESET ORBIT SETTINGS</button>
    </aside>
  );
}

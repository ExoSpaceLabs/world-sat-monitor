import type {PersistentSatelliteSettings} from "../../domain/settings";

type SatelliteSettingsPanelProps = {
  settings: PersistentSatelliteSettings;
  effectivePathResolution: number | null;
  onChange: (settings: PersistentSatelliteSettings) => void;
  onReset: () => void;
  onClose: () => void;
};

function RangeControl({
  label, detail, value, min, max, step, suffix, onChange,
}: {
  label: string; detail: string; value: number; min: number; max: number;
  step: number; suffix: string; onChange: (value: number) => void;
}) {
  return (
    <label className="sat-range-control">
      <span><b>{label}</b><output>{value}{suffix}</output></span>
      <small>{detail}</small>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))}/>
    </label>
  );
}

export function SatelliteSettingsPanel({
  settings, effectivePathResolution, onChange, onReset, onClose,
}: SatelliteSettingsPanelProps) {
  const updatePath = (patch: Partial<PersistentSatelliteSettings["path"]>) =>
    onChange({...settings, path: {...settings.path, ...patch}});

  return (
    <aside className="settings-panel satellite-settings-panel" aria-label="Satellite settings">
      <div className="settings-head">
        <div><small>ORBIT DISPLAY CONTROL</small><h2>SATELLITE SETTINGS</h2></div>
        <button onClick={onClose} aria-label="Close satellite settings">×</button>
      </div>
      <section>
        <h3>ACTIVE OBJECT</h3>
        <div className="sat-setting-readout"><span>NORAD ID</span><b>{settings.selected_norad_id}</b></div>
      </section>
      <section>
        <h3>GROUND TRACK</h3>
        <div className="scene-options">
          <button className="scene-toggle" role="switch" aria-checked={settings.path.enabled}
            onClick={() => updatePath({enabled: !settings.path.enabled})}>
            <span><b>DRAW SATELLITE PATH</b><small>HISTORY · CURRENT STATE · PREDICTION</small></span>
            <i className={settings.path.enabled ? "enabled" : ""}/>
          </button>
          <RangeControl label="HISTORY" detail="Ground track shown before display UTC"
            value={settings.path.history_minutes} min={0} max={1440} step={10} suffix=" min"
            onChange={(history_minutes) => updatePath({history_minutes})}/>
          <RangeControl label="PREDICTION" detail="Future propagated ground track, up to 14 days"
            value={settings.path.prediction_hours} min={0} max={336} step={1} suffix=" h"
            onChange={(prediction_hours) => updatePath({prediction_hours})}/>
          <RangeControl label="REQUESTED PATH STEP" detail="Backend may decimate further to protect response size"
            value={settings.path.resolution_seconds} min={10} max={600} step={10} suffix=" s"
            onChange={(resolution_seconds) => updatePath({resolution_seconds})}/>
          <div className="sat-setting-readout"><span>EFFECTIVE PATH STEP</span><b>{effectivePathResolution ? `${effectivePathResolution} s` : "--"}</b></div>
        </div>
      </section>
      <section>
        <h3>UPDATES</h3>
        <div className="scene-options">
          <RangeControl label="POSITION INTERPOLATION UPDATE" detail="How often the frontend requests the backend interpolator"
            value={settings.position_update_ms} min={100} max={5000} step={100} suffix=" ms"
            onChange={(position_update_ms) => onChange({...settings, position_update_ms})}/>
          <RangeControl label="PATH REFRESH" detail="How often the history/prediction window is re-queried"
            value={settings.path.refresh_seconds} min={5} max={600} step={5} suffix=" s"
            onChange={(refresh_seconds) => updatePath({refresh_seconds})}/>
        </div>
      </section>
      <div className="rotation-state"><span>PERSISTENCE</span><b>/data/settings.json</b></div>
      <button className="settings-reset" onClick={onReset}>RESET SATELLITE SETTINGS</button>
    </aside>
  );
}

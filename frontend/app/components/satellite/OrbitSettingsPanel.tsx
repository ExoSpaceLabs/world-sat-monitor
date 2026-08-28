import {
  DEFAULT_APP_SETTINGS,
  type GroupMarkerPlacement,
  type GroupOrbitDisplaySettings,
  type OrbitDisplaySettings,
  type OrbitTrackMode,
} from "../../domain/settings";

export const ORBIT_DISPLAY_CHANGE_EVENT = "worldsat:orbit-display-change";

type OrbitSettingsPanelProps = {
  displayMode: "satellite" | "group";
  singleSettings: OrbitDisplaySettings;
  groupSettings: GroupOrbitDisplaySettings;
  effectivePathResolution: number | null;
  onSingleChange: (settings: OrbitDisplaySettings) => void;
  onGroupChange: (settings: GroupOrbitDisplaySettings) => void;
  onReset: () => void;
  onClose: () => void;
};

function notifyOrbitDisplayChange(settings: OrbitDisplaySettings) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OrbitDisplaySettings>(ORBIT_DISPLAY_CHANGE_EVENT, {detail: settings}));
}

function RangeControl({label, detail, value, min, max, step, suffix, onChange}: {
  label: string; detail: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void;
}) {
  return (
    <label className="sat-range-control">
      <span><b>{label}</b><output>{value}{suffix}</output></span>
      <small>{detail}</small>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/>
    </label>
  );
}

export function OrbitSettingsPanel({
  displayMode,
  singleSettings,
  groupSettings,
  effectivePathResolution,
  onSingleChange,
  onGroupChange,
  onReset,
  onClose,
}: OrbitSettingsPanelProps) {
  const commitSingle = (next: OrbitDisplaySettings) => {
    notifyOrbitDisplayChange(next);
    onSingleChange(next);
  };
  const updateSinglePath = (patch: Partial<OrbitDisplaySettings["path"]>) =>
    commitSingle({...singleSettings, path: {...singleSettings.path, ...patch}});
  const setTrackMode = (mode: OrbitTrackMode) => updateSinglePath({mode});
  const updateGroup = (patch: Partial<GroupOrbitDisplaySettings>) =>
    onGroupChange({...groupSettings, ...patch});
  const setGroupPlacement = (marker_placement: GroupMarkerPlacement) => updateGroup({marker_placement});
  const reset = () => {
    if (displayMode === "satellite") notifyOrbitDisplayChange(DEFAULT_APP_SETTINGS.orbit);
    onReset();
  };

  return (
    <aside className="settings-panel orbit-settings-panel" aria-label={displayMode === "group" ? "Group settings" : "Object settings"}>
      <div className="settings-head">
        <div>
          <small>{displayMode === "group" ? "CONSTELLATION DISPLAY + PROPAGATION" : "SELECTED OBJECT DISPLAY"}</small>
          <h2>{displayMode === "group" ? "GROUP SETTINGS" : "OBJECT SETTINGS"}</h2>
        </div>
        <button onClick={onClose} aria-label="Close settings">×</button>
      </div>

      {displayMode === "satellite" ? (
        <>
          <section>
            <h3>OBJECT + ORBIT</h3>
            <div className="scene-options">
              <button className="scene-toggle" role="switch" aria-checked={singleSettings.path.enabled} onClick={() => updateSinglePath({enabled: !singleSettings.path.enabled})}>
                <span><b>DRAW ORBIT PATH</b><small>ONLY THE SELECTED OBJECT GETS A DETAILED PATH</small></span>
                <i className={singleSettings.path.enabled ? "enabled" : ""}/>
              </button>
              <button className="scene-toggle" role="switch" aria-checked={singleSettings.direction_vector_enabled} onClick={() => commitSingle({...singleSettings, direction_vector_enabled: !singleSettings.direction_vector_enabled})}>
                <span><b>DRAW DIRECTION VECTOR</b><small>SHOW CURRENT OBJECT HEADING</small></span>
                <i className={singleSettings.direction_vector_enabled ? "enabled" : ""}/>
              </button>
              <div className="track-mode-control" role="group" aria-label="Object and orbit placement">
                <span><b>OBJECT + TRACK PLACEMENT</b><small>GROUND = SATELLITE AND TRACK AT NADIR · ORBIT = BOTH AT PHYSICAL ALTITUDE</small></span>
                <div>
                  <button className={singleSettings.path.mode === "ground" ? "active" : ""} onClick={() => setTrackMode("ground")}>GROUND</button>
                  <button className={singleSettings.path.mode === "orbit" ? "active" : ""} onClick={() => setTrackMode("orbit")}>ORBIT</button>
                </div>
              </div>
              <RangeControl label="HISTORY" detail="Track shown before display UTC for the selected object" value={singleSettings.path.history_minutes} min={0} max={1440} step={10} suffix=" min" onChange={(history_minutes) => updateSinglePath({history_minutes})}/>
              <RangeControl label="PREDICTION" detail="Future detailed track for the selected object" value={singleSettings.path.prediction_hours} min={0} max={336} step={1} suffix=" h" onChange={(prediction_hours) => updateSinglePath({prediction_hours})}/>
              <RangeControl label="REQUESTED PATH STEP" detail="API sampling request; backend may decimate further" value={singleSettings.path.resolution_seconds} min={10} max={600} step={10} suffix=" s" onChange={(resolution_seconds) => updateSinglePath({resolution_seconds})}/>
              <div className="sat-setting-readout"><span>EFFECTIVE PATH STEP</span><b>{effectivePathResolution ? `${effectivePathResolution} s` : "--"}</b></div>
            </div>
          </section>
          <section>
            <h3>UPDATES</h3>
            <div className="scene-options">
              <RangeControl label="POSITION INTERPOLATION UPDATE" detail="Selected-object position request cadence" value={singleSettings.position_update_ms} min={100} max={5000} step={100} suffix=" ms" onChange={(position_update_ms) => commitSingle({...singleSettings, position_update_ms})}/>
              <RangeControl label="PATH REFRESH" detail="Re-query cadence for the selected history/prediction window" value={singleSettings.path.refresh_seconds} min={5} max={600} step={5} suffix=" s" onChange={(refresh_seconds) => updateSinglePath({refresh_seconds})}/>
            </div>
          </section>
        </>
      ) : (
        <>
          <section>
            <h3>GROUP RENDERING</h3>
            <div className="scene-options">
              <div className="track-mode-control" role="group" aria-label="Group satellite placement">
                <span><b>MARKER PLACEMENT</b><small>ORBIT = PHYSICAL ALTITUDE · NADIR = PROJECT MEMBERS ON EARTH</small></span>
                <div>
                  <button className={groupSettings.marker_placement === "orbit" ? "active" : ""} onClick={() => setGroupPlacement("orbit")}>ORBIT</button>
                  <button className={groupSettings.marker_placement === "nadir" ? "active" : ""} onClick={() => setGroupPlacement("nadir")}>NADIR</button>
                </div>
              </div>
              <button className="scene-toggle" role="switch" aria-checked={groupSettings.show_satellite_names} onClick={() => updateGroup({show_satellite_names: !groupSettings.show_satellite_names})}>
                <span><b>SHOW SATELLITE NAMES</b><small>DRAW MEMBER NAMES; HOVER ALWAYS SHOWS THE NAME</small></span>
                <i className={groupSettings.show_satellite_names ? "enabled" : ""}/>
              </button>
              <button className="scene-toggle" role="switch" aria-checked={groupSettings.direction_vector_enabled} onClick={() => updateGroup({direction_vector_enabled: !groupSettings.direction_vector_enabled})}>
                <span><b>DRAW DIRECTION VECTORS</b><small>LIGHTWEIGHT HEADING VECTOR FOR EACH READY MEMBER</small></span>
                <i className={groupSettings.direction_vector_enabled ? "enabled" : ""}/>
              </button>
            </div>
          </section>
          <section>
            <h3>GROUP PROPAGATION</h3>
            <div className="scene-options">
              <div className="rotation-state"><span>PATH POLICY</span><b>MEMBER ORBIT PATHS DISABLED</b></div>
              <p className="settings-copy">The prediction window controls how far ahead member positions are prepared. Individual group orbit paths are intentionally not rendered.</p>
              <RangeControl label="PREDICTION WINDOW" detail="Temporary propagation horizon for every displayed group member" value={groupSettings.prediction_hours} min={1} max={24} step={1} suffix=" h" onChange={(prediction_hours) => updateGroup({prediction_hours})}/>
              <RangeControl label="PROPAGATION STEP" detail="Stored group-display cadence; larger groups benefit from coarser steps" value={groupSettings.step_seconds} min={30} max={600} step={30} suffix=" s" onChange={(step_seconds) => updateGroup({step_seconds})}/>
            </div>
          </section>
          <section>
            <h3>UPDATES</h3>
            <div className="scene-options">
              <RangeControl label="MARKER UPDATE" detail="Batched group-position query cadence" value={groupSettings.position_update_ms} min={500} max={5000} step={500} suffix=" ms" onChange={(position_update_ms) => updateGroup({position_update_ms})}/>
              <RangeControl label="DISPLAY LEASE REFRESH" detail="Keeps temporary inactive-member propagation requested while the group remains displayed" value={groupSettings.refresh_seconds} min={15} max={300} step={15} suffix=" s" onChange={(refresh_seconds) => updateGroup({refresh_seconds})}/>
            </div>
          </section>
        </>
      )}

      <div className="rotation-state"><span>PERSISTENCE</span><b>/data/settings.json</b></div>
      <button className="settings-reset" onClick={reset}>RESET {displayMode === "group" ? "GROUP" : "OBJECT"} SETTINGS</button>
    </aside>
  );
}

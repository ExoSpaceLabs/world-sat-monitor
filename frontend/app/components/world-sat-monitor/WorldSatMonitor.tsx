"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {SpaceBackground} from "../background/SpaceBackground";
import {DayNightLayer, type ShadowDebugState} from "../day-night/DayNightLayer";
import {GlobeMap} from "../globe/GlobeMap";
import {OrbitSettingsPanel} from "../satellite/OrbitSettingsPanel";
import type {OrbitDebugState} from "../satellite/OrbitTrackLayer";
import {SatelliteLayer} from "../satellite/SatelliteLayer";
import {SatellitePanel} from "../satellite/SatellitePanel";
import {MapSettingsPanel} from "../settings/MapSettingsPanel";
import {INITIAL_UTC, INITIAL_VIEW, normalizeLongitude, type SceneOrientation} from "../../domain/scene";
import {EARTH_RADIUS_KM, MOCK_SATELLITE, type Satellite, type SatelliteTrackPoint} from "../../domain/satellite";
import {DEFAULT_APP_SETTINGS, type AppSettings, type OrbitDisplaySettings} from "../../domain/settings";
import {DEFAULT_BASEMAP, DEFAULT_SCENE_OPTIONS, type Basemap, type MapSession, type MapState, type SceneOptions} from "../../domain/types";
import {getSolarState} from "../../domain/solar";
import {getAppSettings, getSatellitePosition, getSatelliteTrack, saveAppSettings} from "../../services/worldsat-api";

type SimulationClock = {initialized: boolean; realAnchorMs: number; simulationAnchorMs: number; scale: number};
type RotationReason = "active" | "follow" | "zoom";
type ApiState = "connecting" | "online" | "offline";
type PersistenceState = "loading" | "saved" | "saving" | "error";

const NORMAL_SIMULATION_TICK_MS = 250;
const ACCELERATED_SIMULATION_TICK_MS = 33;
const SETTINGS_SAVE_DEBOUNCE_MS = 250;
const ACTIVE_NORAD_ID = Number(MOCK_SATELLITE.norad);

const EMPTY_ORBIT_DEBUG: OrbitDebugState = {
  error: null,
  headingVertices: 0,
  historyVertices: 0,
  predictionVertices: 0,
  ready: false,
  shaderVariant: "--",
};

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
}

function BasemapCredit({basemap}: {basemap: Basemap}) {
  if (basemap === "satellite") return <>Imagery © <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a> & providers · Overlays © OpenStreetMap</>;
  if (basemap === "street") return <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></>;
  return <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a></>;
}

export function WorldSatMonitor() {
  const [resetKey, setResetKey] = useState(0);
  const [timeResetKey, setTimeResetKey] = useState(0);
  const [timeScale, setTimeScale] = useState(1);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [orbitSettingsOpen, setOrbitSettingsOpen] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapSession, setMapSession] = useState<MapSession | null>(null);
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  const [scene, setScene] = useState<SceneOptions>({...DEFAULT_SCENE_OPTIONS});
  const [followSatellite, setFollowSatellite] = useState(false);
  const [satellite, setSatellite] = useState<Satellite>(MOCK_SATELLITE);
  const [satelliteTrack, setSatelliteTrack] = useState<SatelliteTrackPoint[]>([]);
  const [satelliteIsMock, setSatelliteIsMock] = useState(true);
  const [positionInterpolated, setPositionInterpolated] = useState(false);
  const [effectivePathResolution, setEffectivePathResolution] = useState<number | null>(null);
  const [apiState, setApiState] = useState<ApiState>("connecting");
  const [persistenceState, setPersistenceState] = useState<PersistenceState>("loading");
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [now, setNow] = useState(INITIAL_UTC);
  const nowRef = useRef(INITIAL_UTC);
  const settingsSaveTimerRef = useRef<number | null>(null);
  const simulationClockRef = useRef<SimulationClock>({initialized: false, realAnchorMs: 0, simulationAnchorMs: 0, scale: 1});
  const [shadowDebug, setShadowDebug] = useState<ShadowDebugState>({ready: false, triangleCount: 0});
  const [orbitDebug, setOrbitDebug] = useState<OrbitDebugState>(EMPTY_ORBIT_DEBUG);
  const [orientation, setOrientation] = useState<SceneOrientation>({longitude: INITIAL_VIEW.center[0], inertialLongitude: INITIAL_VIEW.center[0], earthRotationDegrees: 0, cameraLockedToEarth: false, latitude: INITIAL_VIEW.center[1], zoom: INITIAL_VIEW.zoom, bearing: INITIAL_VIEW.bearing, pitch: INITIAL_VIEW.pitch});
  const [rotationReason, setRotationReason] = useState<RotationReason>("active");

  const pathActive = appSettings.orbit.path.enabled
    && (appSettings.orbit.path.history_minutes > 0 || appSettings.orbit.path.prediction_hours > 0);

  const applyTimeScale = useCallback((scale: number) => {
    const nextScale = Math.max(0, scale);
    const realTimestamp = Date.now();
    const state = simulationClockRef.current;
    const simulationTimestamp = state.initialized
      ? state.simulationAnchorMs + (realTimestamp - state.realAnchorMs) * state.scale
      : realTimestamp;
    simulationClockRef.current = {initialized: true, realAnchorMs: realTimestamp, simulationAnchorMs: simulationTimestamp, scale: nextScale};
    setTimeScale(nextScale);
    const nextNow = new Date(simulationTimestamp);
    nowRef.current = nextNow;
    setNow(nextNow);
  }, []);

  const scheduleSettingsSave = useCallback((next: AppSettings) => {
    if (settingsSaveTimerRef.current !== null) window.clearTimeout(settingsSaveTimerRef.current);
    setPersistenceState("saving");
    settingsSaveTimerRef.current = window.setTimeout(() => {
      void saveAppSettings(next)
        .then(() => { setPersistenceState("saved"); setApiState("online"); })
        .catch(() => { setPersistenceState("error"); setApiState("offline"); });
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  }, []);

  const updateSettings = useCallback((next: AppSettings) => {
    setAppSettings(next);
    scheduleSettingsSave(next);
  }, [scheduleSettingsSave]);

  useEffect(() => () => {
    if (settingsSaveTimerRef.current !== null) window.clearTimeout(settingsSaveTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAppSettings().then((loaded) => {
      if (cancelled) return;
      setAppSettings(loaded);
      setBasemap(loaded.map.basemap);
      setScene({spaceEnvironment: loaded.map.space_environment, shadowOpacity: loaded.map.shadow_opacity, debug: loaded.map.debug});
      applyTimeScale(loaded.map.time_scale);
      setSettingsLoaded(true);
      setPersistenceState("saved");
      setApiState("online");
    }).catch(() => {
      if (!cancelled) {
        setSettingsLoaded(true);
        setPersistenceState("error");
        setApiState("offline");
      }
    });
    return () => { cancelled = true; };
  }, [applyTimeScale]);

  useEffect(() => {
    const realNow = Date.now();
    if (!simulationClockRef.current.initialized) {
      simulationClockRef.current = {initialized: true, realAnchorMs: realNow, simulationAnchorMs: realNow, scale: 1};
    }
    const tick = () => {
      const state = simulationClockRef.current;
      const realTimestamp = Date.now();
      const simulationTimestamp = state.simulationAnchorMs + (realTimestamp - state.realAnchorMs) * state.scale;
      const nextNow = new Date(simulationTimestamp);
      nowRef.current = nextNow;
      setNow(nextNow);
    };
    tick();
    const clock = window.setInterval(tick, timeScale > 1 ? ACCELERATED_SIMULATION_TICK_MS : NORMAL_SIMULATION_TICK_MS);
    return () => window.clearInterval(clock);
  }, [timeScale]);

  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await getSatellitePosition(ACTIVE_NORAD_ID, nowRef.current);
        if (!cancelled) {
          setSatellite(result.satellite);
          setSatelliteIsMock(result.isMock);
          setPositionInterpolated(result.interpolated);
          setApiState("online");
        }
      } catch {
        if (!cancelled) setApiState("offline");
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, appSettings.orbit.position_update_ms);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [appSettings.orbit.position_update_ms, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !pathActive) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      const center = nowRef.current;
      const start = new Date(center.getTime() - appSettings.orbit.path.history_minutes * 60_000);
      const end = new Date(center.getTime() + appSettings.orbit.path.prediction_hours * 3_600_000);
      try {
        const result = await getSatelliteTrack(
          ACTIVE_NORAD_ID,
          start,
          end,
          appSettings.orbit.path.resolution_seconds,
          center,
        );
        if (!cancelled) {
          setSatelliteTrack(result.points);
          setEffectivePathResolution(result.resolutionSeconds);
          setSatelliteIsMock(result.isMock);
          setApiState("online");
        }
      } catch {
        if (!cancelled) setApiState("offline");
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, appSettings.orbit.path.refresh_seconds * 1000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [appSettings.orbit.path.history_minutes, appSettings.orbit.path.prediction_hours, appSettings.orbit.path.refresh_seconds, appSettings.orbit.path.resolution_seconds, pathActive, settingsLoaded]);

  const solarState = useMemo(() => getSolarState(now), [now]);
  const persistMapSettings = useCallback((patch: Partial<AppSettings["map"]>) => {
    updateSettings({...appSettings, map: {...appSettings.map, ...patch}});
  }, [appSettings, updateSettings]);
  const handleBasemapChange = useCallback((next: Basemap) => { setBasemap(next); persistMapSettings({basemap: next}); }, [persistMapSettings]);
  const handleEnvironmentChange = useCallback((enabled: boolean) => { setScene((current) => ({...current, spaceEnvironment: enabled})); persistMapSettings({space_environment: enabled}); }, [persistMapSettings]);
  const handleDebugChange = useCallback((debug: boolean) => { setScene((current) => ({...current, debug})); persistMapSettings({debug}); }, [persistMapSettings]);
  const handleShadowDebugChange = useCallback((next: ShadowDebugState) => { setShadowDebug((current) => current.ready === next.ready && current.triangleCount === next.triangleCount ? current : next); }, []);
  const handleOrbitDebugChange = useCallback((next: OrbitDebugState) => {
    setOrbitDebug((current) => current.ready === next.ready
      && current.shaderVariant === next.shaderVariant
      && current.historyVertices === next.historyVertices
      && current.predictionVertices === next.predictionVertices
      && current.headingVertices === next.headingVertices
      && current.error === next.error
      ? current
      : next);
  }, []);
  const handleShadowOpacityChange = useCallback((shadowOpacity: number) => { setScene((current) => ({...current, shadowOpacity})); persistMapSettings({shadow_opacity: shadowOpacity}); }, [persistMapSettings]);
  const handleTimeScaleChange = useCallback((scale: number) => { applyTimeScale(scale); persistMapSettings({time_scale: scale}); }, [applyTimeScale, persistMapSettings]);
  const handleTimeReset = useCallback(() => {
    const realTimestamp = Date.now();
    const scale = simulationClockRef.current.scale;
    simulationClockRef.current = {initialized: true, realAnchorMs: realTimestamp, simulationAnchorMs: realTimestamp, scale};
    const nextNow = new Date(realTimestamp);
    nowRef.current = nextNow;
    setNow(nextNow);
    setTimeResetKey((key) => key + 1);
  }, []);
  const handleRotationChange = useCallback((_active: boolean, reason: RotationReason) => { setRotationReason((current) => current === reason ? current : reason); }, []);
  const handleReset = useCallback(() => { setFollowSatellite(false); setResetKey((key) => key + 1); }, []);
  const handleMapSettingsReset = useCallback(() => {
    const defaults = DEFAULT_APP_SETTINGS.map;
    setBasemap(defaults.basemap);
    setScene({spaceEnvironment: defaults.space_environment, shadowOpacity: defaults.shadow_opacity, debug: defaults.debug});
    applyTimeScale(defaults.time_scale);
    handleTimeReset();
    updateSettings({...appSettings, map: {...defaults}});
  }, [appSettings, applyTimeScale, handleTimeReset, updateSettings]);
  const handleOrbitSettingsChange = useCallback((next: OrbitDisplaySettings) => {
    updateSettings({...appSettings, orbit: next});
  }, [appSettings, updateSettings]);
  const handleOrbitSettingsReset = useCallback(() => {
    updateSettings({...appSettings, orbit: {...DEFAULT_APP_SETTINGS.orbit, path: {...DEFAULT_APP_SETTINGS.orbit.path}}});
  }, [appSettings, updateSettings]);
  const handleSatelliteSelect = useCallback(() => setFollowSatellite(true), []);

  const rotationLabel = followSatellite
    ? "CAMERA LOCKED TO SATELLITE · EARTH ROTATING"
    : rotationReason === "zoom"
      ? "CAMERA LOCKED TO EARTH ROTATION"
      : `${timeScale}× EARTH ROTATION ACTIVE`;
  const cameraSunDelta = normalizeLongitude(orientation.longitude - solarState.longitude);
  const altitudeRatio = satellite.altitude / EARTH_RADIUS_KM;
  const mapProjection = mapSession?.map.getProjection().type ?? "--";

  return (
    <main className="monitor-shell" data-layer="page">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"/><div><strong>WORLDSAT</strong><small>MISSION MONITOR</small></div></div>
        <div className="topbar-actions">
          <div className="system-state"><span className={apiState === "online" ? "online" : ""}/> {satelliteIsMock ? "MOCK DATA" : "PROPAGATED DATA"} <b>UTC {now === INITIAL_UTC ? "--:--:--" : now.toISOString().slice(11, 19)}</b></div>
          <button className={`settings-trigger ${orbitSettingsOpen ? "active" : ""}`} onClick={() => { setOrbitSettingsOpen((open) => !open); setMapSettingsOpen(false); }} aria-expanded={orbitSettingsOpen} aria-label="Open orbit settings"><i/><span>ORBIT SETTINGS</span></button>
          <button className={`settings-trigger ${mapSettingsOpen ? "active" : ""}`} onClick={() => { setMapSettingsOpen((open) => !open); setOrbitSettingsOpen(false); }} aria-expanded={mapSettingsOpen} aria-label="Open map settings"><i/><span>MAP SETTINGS</span></button>
        </div>
      </header>
      <section className="viewport">
        <SpaceBackground enabled={scene.spaceEnvironment} orientation={orientation} solarState={solarState}/>
        <GlobeMap basemap={basemap} followSatellite={followSatellite} resetKey={resetKey} satellite={satellite} timeResetKey={timeResetKey} timeScale={timeScale} onMapSession={setMapSession} onMapState={setMapState} onOrientationChange={setOrientation} onRotationChange={handleRotationChange}>
          <DayNightLayer enabled={scene.spaceEnvironment} mapSession={mapSession} onDebugState={handleShadowDebugChange} opacity={scene.shadowOpacity} solarState={solarState}/>
        </GlobeMap>
        <SatelliteLayer mapSession={mapSession} satellite={satellite} track={pathActive ? satelliteTrack : []} selected onSelect={handleSatelliteSelect} onDebugState={handleOrbitDebugChange}/>
        <div className="eyebrow">ORBITAL VIEW / EARTH DETAIL</div>
        <div className="coordinates">{formatCoordinate(orientation.latitude, "N", "S")}&nbsp;&nbsp; {formatCoordinate(orientation.longitude, "E", "W")}&nbsp;&nbsp; Z{orientation.zoom.toFixed(1)}</div>
        {scene.debug && <aside className="debug-overlay" data-layer="debug-overlay" aria-label="Scene debug telemetry"><strong>SCENE DEBUG</strong><dl><div><dt>SIM UTC</dt><dd>{now.toISOString()}</dd></div><div><dt>TIME SCALE</dt><dd>{timeScale}×</dd></div><div><dt>EARTH ROT</dt><dd>{orientation.earthRotationDegrees.toFixed(3)}°</dd></div><div><dt>CAMERA FRAME</dt><dd>{orientation.cameraLockedToEarth ? "EARTH-LOCKED" : "INERTIAL"}</dd></div><div><dt>MAP PROJECTION</dt><dd>{mapProjection.toUpperCase()}</dd></div><div><dt>SUBSOLAR LON</dt><dd>{solarState.longitude.toFixed(3)}°</dd></div><div><dt>SUN RA (ECI)</dt><dd>{solarState.rightAscension.toFixed(3)}°</dd></div><div><dt>CAMERA / SUN Δ</dt><dd>{cameraSunDelta.toFixed(3)}°</dd></div><div><dt>SHADOW RENDER</dt><dd className={shadowDebug.ready ? "ok" : "bad"}>{shadowDebug.ready ? "READY" : "MISSING"}</dd></div><div><dt>SHADOW MESH</dt><dd>{shadowDebug.triangleCount} TRIANGLES</dd></div><div><dt>ORBIT RENDER</dt><dd className={orbitDebug.ready ? "ok" : "bad"}>{orbitDebug.ready ? "READY" : "MISSING"}</dd></div><div><dt>ORBIT SHADER</dt><dd>{orbitDebug.shaderVariant.toUpperCase()}</dd></div><div><dt>ORBIT VERTICES</dt><dd>{orbitDebug.historyVertices} H · {orbitDebug.predictionVertices} P · {orbitDebug.headingVertices} V</dd></div><div><dt>ORBIT ERROR</dt><dd className={orbitDebug.error ? "bad" : ""}>{orbitDebug.error ?? "--"}</dd></div><div><dt>SAT ALTITUDE</dt><dd>{satellite.altitude.toFixed(1)} km · {(altitudeRatio * 100).toFixed(2)}% R⊕</dd></div><div><dt>PATH POINTS</dt><dd>{pathActive ? satelliteTrack.length : 0}</dd></div><div><dt>PATH STEP</dt><dd>{pathActive && effectivePathResolution ? `${effectivePathResolution} s` : "--"}</dd></div></dl></aside>}
        {mapSettingsOpen && <MapSettingsPanel basemap={basemap} scene={scene} timeScale={timeScale} onBasemapChange={handleBasemapChange} onDebugChange={handleDebugChange} onEnvironmentChange={handleEnvironmentChange} onShadowOpacityChange={handleShadowOpacityChange} onTimeReset={handleTimeReset} onTimeScaleChange={handleTimeScaleChange} onReset={handleMapSettingsReset} onClose={() => setMapSettingsOpen(false)}/>} 
        {orbitSettingsOpen && <OrbitSettingsPanel settings={appSettings.orbit} effectivePathResolution={pathActive ? effectivePathResolution : null} onChange={handleOrbitSettingsChange} onReset={handleOrbitSettingsReset} onClose={() => setOrbitSettingsOpen(false)}/>} 
        <SatellitePanel basemap={basemap} followSatellite={followSatellite} satellite={satellite} solarState={solarState} isMock={satelliteIsMock} interpolated={positionInterpolated} onToggleFollow={() => setFollowSatellite((active) => !active)}/>
        <div className="map-credit"><BasemapCredit basemap={basemap}/></div>
        <div className="legend"><span><i className="sat-symbol"/> SATELLITE</span><span><i className="history-symbol"/> HISTORY</span><span><i className="prediction-symbol"/> PREDICTION</span><span><i className="vector-symbol"/> HEADING VECTOR</span></div>
        <div className="controls"><span>{rotationLabel}</span><span>DRAG CHANGES CAMERA · EARTH KEEPS ROTATING</span><button onClick={handleReset} aria-label="Reset globe camera">RESET VIEW</button></div>
      </section>
      <footer><span>1 OBJECT TRACKED</span><span>MAP <b className={mapState === "ready" ? "online" : ""}>{mapState.toUpperCase()}</b></span><span>ENVIRONMENT <b className={scene.spaceEnvironment ? "online" : ""}>{scene.spaceEnvironment ? `${timeScale}× UTC` : "OFF"}</b></span><span>API <b className={apiState === "online" ? "online" : ""}>{apiState.toUpperCase()}</b></span><span>SETTINGS <b className={persistenceState === "saved" ? "online" : ""}>{persistenceState.toUpperCase()}</b></span><em>UI CHECKPOINT 0.8</em></footer>
    </main>
  );
}

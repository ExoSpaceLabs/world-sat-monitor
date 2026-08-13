"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {SpaceBackground} from "../background/SpaceBackground";
import {DayNightLayer, type ShadowDebugState} from "../day-night/DayNightLayer";
import {GlobeMap} from "../globe/GlobeMap";
import {SatelliteLayer} from "../satellite/SatelliteLayer";
import {SatellitePanel} from "../satellite/SatellitePanel";
import {MapSettingsPanel} from "../settings/MapSettingsPanel";
import {
  INITIAL_UTC,
  INITIAL_VIEW,
  normalizeLongitude,
  type SceneOrientation,
} from "../../domain/scene";
import {EARTH_RADIUS_KM, MOCK_SATELLITE} from "../../domain/satellite";
import {
  DEFAULT_BASEMAP,
  DEFAULT_SCENE_OPTIONS,
  type Basemap,
  type MapSession,
  type MapState,
  type SceneOptions,
} from "../../domain/types";
import {getSolarState, inertialSolarLongitude} from "../../domain/solar";

type SimulationClock = {
  initialized: boolean;
  realAnchorMs: number;
  simulationAnchorMs: number;
  scale: number;
};

type RotationReason = "active" | "follow" | "zoom";

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
}

function BasemapCredit({basemap}: {basemap: Basemap}) {
  if (basemap === "satellite") {
    return <>Imagery © <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a> & providers · Overlays © OpenStreetMap</>;
  }
  if (basemap === "street") {
    return <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></>;
  }
  return <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a></>;
}

export function WorldSatMonitor() {
  const [resetKey, setResetKey] = useState(0);
  const [timeResetKey, setTimeResetKey] = useState(0);
  const [timeScale, setTimeScale] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapSession, setMapSession] = useState<MapSession | null>(null);
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  const [scene, setScene] = useState<SceneOptions>({...DEFAULT_SCENE_OPTIONS});
  const [followSatellite, setFollowSatellite] = useState(false);
  const [now, setNow] = useState(INITIAL_UTC);
  const [shadowDebug, setShadowDebug] = useState<ShadowDebugState>({
    ready: false,
    radiusPx: null,
  });
  const simulationClockRef = useRef<SimulationClock>({
    initialized: false,
    realAnchorMs: 0,
    simulationAnchorMs: 0,
    scale: 1,
  });
  const [orientation, setOrientation] = useState<SceneOrientation>({
    longitude: INITIAL_VIEW.center[0],
    inertialLongitude: INITIAL_VIEW.center[0],
    earthRotationDegrees: 0,
    cameraLockedToEarth: false,
    latitude: INITIAL_VIEW.center[1],
    zoom: INITIAL_VIEW.zoom,
    bearing: INITIAL_VIEW.bearing,
    pitch: INITIAL_VIEW.pitch,
  });
  const [rotationReason, setRotationReason] = useState<RotationReason>("active");

  useEffect(() => {
    const realNow = Date.now();
    simulationClockRef.current = {
      initialized: true,
      realAnchorMs: realNow,
      simulationAnchorMs: realNow,
      scale: 1,
    };
    const clock = window.setInterval(() => {
      const state = simulationClockRef.current;
      const realTimestamp = Date.now();
      const simulationTimestamp = state.simulationAnchorMs
        + (realTimestamp - state.realAnchorMs) * state.scale;
      setNow(new Date(simulationTimestamp));
    }, 250);
    return () => window.clearInterval(clock);
  }, []);

  const solarState = useMemo(() => getSolarState(now), [now]);

  const handleEnvironmentChange = useCallback((enabled: boolean) => {
    setScene((current) => ({...current, spaceEnvironment: enabled}));
  }, []);
  const handleDebugChange = useCallback((debug: boolean) => {
    setScene((current) => ({...current, debug}));
  }, []);
  const handleShadowDebugChange = useCallback((next: ShadowDebugState) => {
    setShadowDebug((current) => (
      current.ready === next.ready && current.radiusPx === next.radiusPx
        ? current
        : next
    ));
  }, []);
  const handleShadowOpacityChange = useCallback((shadowOpacity: number) => {
    setScene((current) => ({...current, shadowOpacity}));
  }, []);
  const handleTimeScaleChange = useCallback((scale: number) => {
    const nextScale = Math.max(0, scale);
    const realTimestamp = Date.now();
    const state = simulationClockRef.current;
    const simulationTimestamp = state.initialized
      ? state.simulationAnchorMs + (realTimestamp - state.realAnchorMs) * state.scale
      : realTimestamp;
    simulationClockRef.current = {
      initialized: true,
      realAnchorMs: realTimestamp,
      simulationAnchorMs: simulationTimestamp,
      scale: nextScale,
    };
    setTimeScale(nextScale);
    setNow(new Date(simulationTimestamp));
  }, []);
  const handleTimeReset = useCallback(() => {
    const realTimestamp = Date.now();
    const scale = simulationClockRef.current.scale;
    simulationClockRef.current = {
      initialized: true,
      realAnchorMs: realTimestamp,
      simulationAnchorMs: realTimestamp,
      scale,
    };
    setNow(new Date(realTimestamp));
    setTimeResetKey((key) => key + 1);
  }, []);
  const handleRotationChange = useCallback((_active: boolean, reason: RotationReason) => {
    setRotationReason((current) => current === reason ? current : reason);
  }, []);
  const handleReset = useCallback(() => {
    setFollowSatellite(false);
    setResetKey((key) => key + 1);
  }, []);
  const handleSettingsReset = useCallback(() => {
    setBasemap(DEFAULT_BASEMAP);
    setScene({...DEFAULT_SCENE_OPTIONS});
    handleTimeScaleChange(1);
    handleTimeReset();
  }, [handleTimeReset, handleTimeScaleChange]);
  const handleSatelliteSelect = useCallback(() => setFollowSatellite(true), []);

  const rotationLabel = followSatellite
    ? "CAMERA LOCKED TO SATELLITE · EARTH ROTATING"
    : rotationReason === "zoom"
      ? "CAMERA LOCKED TO EARTH ROTATION"
      : `${timeScale}× EARTH ROTATION ACTIVE`;

  const inertialSunLongitude = inertialSolarLongitude(solarState, orientation.earthRotationDegrees);
  const cameraSunDelta = normalizeLongitude(orientation.longitude - solarState.longitude);
  const altitudeRatio = MOCK_SATELLITE.altitude / EARTH_RADIUS_KM;

  return (
    <main className="monitor-shell" data-layer="page">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"/><div><strong>WORLDSAT</strong><small>MISSION MONITOR</small></div></div>
        <div className="topbar-actions">
          <div className="system-state"><span/> MOCK DATA <b>UTC {now === INITIAL_UTC ? "--:--:--" : now.toISOString().slice(11, 19)}</b></div>
          <button className={`settings-trigger ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-label="Open map settings"><i/><span>MAP SETTINGS</span></button>
        </div>
      </header>

      <section className="viewport">
        <SpaceBackground enabled={scene.spaceEnvironment} orientation={orientation} solarState={solarState}/>
        <GlobeMap
          basemap={basemap}
          followSatellite={followSatellite}
          resetKey={resetKey}
          satellite={MOCK_SATELLITE}
          timeResetKey={timeResetKey}
          timeScale={timeScale}
          onMapSession={setMapSession}
          onMapState={setMapState}
          onOrientationChange={setOrientation}
          onRotationChange={handleRotationChange}
        >
          <DayNightLayer
            enabled={scene.spaceEnvironment}
            mapSession={mapSession}
            onDebugState={handleShadowDebugChange}
            opacity={scene.shadowOpacity}
            orientation={orientation}
            solarState={solarState}
          />
        </GlobeMap>
        <SatelliteLayer
          mapSession={mapSession}
          orientation={orientation}
          satellite={MOCK_SATELLITE}
          selected
          onSelect={handleSatelliteSelect}
        />

        <div className="eyebrow">ORBITAL VIEW / EARTH DETAIL</div>
        <div className="coordinates">{formatCoordinate(orientation.latitude, "N", "S")}&nbsp;&nbsp; {formatCoordinate(orientation.longitude, "E", "W")}&nbsp;&nbsp; Z{orientation.zoom.toFixed(1)}</div>
        {scene.debug && (
          <aside className="debug-overlay" data-layer="debug-overlay" aria-label="Scene debug telemetry">
            <strong>SCENE DEBUG</strong>
            <dl>
              <div><dt>SIM UTC</dt><dd>{now.toISOString()}</dd></div>
              <div><dt>TIME SCALE</dt><dd>{timeScale}×</dd></div>
              <div><dt>EARTH ROT</dt><dd>{orientation.earthRotationDegrees.toFixed(3)}°</dd></div>
              <div><dt>CAMERA FRAME</dt><dd>{orientation.cameraLockedToEarth ? "EARTH-LOCKED" : "INERTIAL"}</dd></div>
              <div><dt>SUBSOLAR LON</dt><dd>{solarState.longitude.toFixed(3)}°</dd></div>
              <div><dt>SUN INERTIAL</dt><dd>{inertialSunLongitude.toFixed(3)}°</dd></div>
              <div><dt>CAMERA / SUN Δ</dt><dd>{cameraSunDelta.toFixed(3)}°</dd></div>
              <div><dt>SHADOW MODE</dt><dd>CANVAS HEMISPHERE</dd></div>
              <div><dt>SHADOW RENDER</dt><dd className={shadowDebug.ready ? "ok" : "bad"}>{shadowDebug.ready ? "READY" : "MISSING"}</dd></div>
              <div><dt>SHADOW RADIUS</dt><dd>{shadowDebug.radiusPx === null ? "--" : `${shadowDebug.radiusPx} px`}</dd></div>
              <div><dt>SAT ALTITUDE</dt><dd>{MOCK_SATELLITE.altitude} km · {(altitudeRatio * 100).toFixed(2)}% R⊕</dd></div>
            </dl>
          </aside>
        )}
        {settingsOpen && (
          <MapSettingsPanel
            basemap={basemap}
            scene={scene}
            timeScale={timeScale}
            onBasemapChange={setBasemap}
            onDebugChange={handleDebugChange}
            onEnvironmentChange={handleEnvironmentChange}
            onShadowOpacityChange={handleShadowOpacityChange}
            onTimeReset={handleTimeReset}
            onTimeScaleChange={handleTimeScaleChange}
            onReset={handleSettingsReset}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        <SatellitePanel
          basemap={basemap}
          followSatellite={followSatellite}
          satellite={MOCK_SATELLITE}
          solarState={solarState}
          onToggleFollow={() => setFollowSatellite((active) => !active)}
        />
        <div className="map-credit"><BasemapCredit basemap={basemap}/></div>
        <div className="legend"><span><i className="sat-symbol"/> SATELLITE</span><span><i className="vector-symbol"/> HEADING VECTOR</span></div>
        <div className="controls"><span>{rotationLabel}</span><span>DRAG CHANGES CAMERA · EARTH KEEPS ROTATING</span><button onClick={handleReset} aria-label="Reset globe camera">RESET VIEW</button></div>
      </section>

      <footer>
        <span>1 OBJECT TRACKED</span>
        <span>MAP <b className={mapState === "ready" ? "online" : ""}>{mapState.toUpperCase()}</b></span>
        <span>ENVIRONMENT <b className={scene.spaceEnvironment ? "online" : ""}>{scene.spaceEnvironment ? `${timeScale}× UTC` : "OFF"}</b></span>
        <span>API <b>NOT CONNECTED</b></span>
        <em>UI CHECKPOINT 0.6</em>
      </footer>
    </main>
  );
}

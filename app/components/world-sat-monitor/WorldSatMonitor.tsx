"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {SpaceBackground} from "../background/SpaceBackground";
import {DayNightLayer} from "../day-night/DayNightLayer";
import {GlobeMap} from "../globe/GlobeMap";
import {SatelliteLayer, SATELLITE_HEADING_LAYER_ID} from "../satellite/SatelliteLayer";
import {SatellitePanel} from "../satellite/SatellitePanel";
import {MapSettingsPanel} from "../settings/MapSettingsPanel";
import {INITIAL_UTC, INITIAL_VIEW, type SceneOrientation} from "../../domain/scene";
import {MOCK_SATELLITE} from "../../domain/satellite";
import type {Basemap, MapSession, MapState, SceneOptions} from "../../domain/types";
import {getSolarState} from "../../domain/solar";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapSession, setMapSession] = useState<MapSession | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [scene, setScene] = useState<SceneOptions>({sky: true, nightShadow: true});
  const [followSatellite, setFollowSatellite] = useState(false);
  const [now, setNow] = useState(INITIAL_UTC);
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
  const [rotation, setRotation] = useState<{
    active: boolean;
    reason: "active" | "follow" | "interaction" | "zoom";
  }>({active: true, reason: "active"});

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  const solarState = useMemo(() => getSolarState(now), [now]);
  const utcMinute = now.toISOString().slice(0, 16);
  const shadowSolarState = useMemo(
    () => getSolarState(new Date(`${utcMinute}:00.000Z`)),
    [utcMinute],
  );

  const handleSceneChange = useCallback((key: keyof SceneOptions, enabled: boolean) => {
    setScene((current) => ({...current, [key]: enabled}));
  }, []);
  const handleRotationChange = useCallback((
    active: boolean,
    reason: "active" | "follow" | "interaction" | "zoom",
  ) => setRotation((current) => current.active === active && current.reason === reason ? current : {active, reason}), []);
  const handleReset = useCallback(() => {
    setFollowSatellite(false);
    setResetKey((key) => key + 1);
  }, []);

  const rotationLabel = followSatellite
    ? "CAMERA LOCKED TO SATELLITE / EARTH ROTATION"
    : rotation.reason === "zoom"
      ? "CAMERA LOCKED TO EARTH ROTATION"
      : rotation.active
        ? "24-HOUR EARTH ROTATION ACTIVE"
        : "EARTH ROTATION PAUSED · INTERACTION";

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
        <SpaceBackground enabled={scene.sky} orientation={orientation} solarState={solarState}/>
        <GlobeMap
          basemap={basemap}
          followSatellite={followSatellite}
          resetKey={resetKey}
          satellite={MOCK_SATELLITE}
          onMapSession={setMapSession}
          onMapState={setMapState}
          onOrientationChange={setOrientation}
          onRotationChange={handleRotationChange}
        />
        <DayNightLayer
          enabled={scene.nightShadow}
          mapSession={mapSession}
          satelliteLayerId={SATELLITE_HEADING_LAYER_ID}
          solarState={shadowSolarState}
          utcMinute={utcMinute}
        />
        <SatelliteLayer
          mapSession={mapSession}
          satellite={MOCK_SATELLITE}
          selected
          onSelect={() => setFollowSatellite(true)}
        />

        <div className="eyebrow">ORBITAL VIEW / EARTH DETAIL</div>
        <div className="coordinates">{formatCoordinate(orientation.latitude, "N", "S")}&nbsp;&nbsp; {formatCoordinate(orientation.longitude, "E", "W")}&nbsp;&nbsp; Z{orientation.zoom.toFixed(1)}</div>
        {settingsOpen && (
          <MapSettingsPanel
            basemap={basemap}
            scene={scene}
            onBasemapChange={setBasemap}
            onSceneChange={handleSceneChange}
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
        <div className="controls"><span>{rotationLabel}</span><span>DRAG PAUSES ROTATION</span><button onClick={handleReset} aria-label="Reset globe camera">RESET VIEW</button></div>
      </section>

      <footer>
        <span>1 OBJECT TRACKED</span>
        <span>MAP <b className={mapState === "ready" ? "online" : ""}>{mapState.toUpperCase()}</b></span>
        <span>SKY <b className={scene.sky ? "online" : ""}>{scene.sky ? "INERTIAL" : "OFF"}</b></span>
        <span>NIGHT <b className={scene.nightShadow ? "online" : ""}>{scene.nightShadow ? "UTC LIVE" : "OFF"}</b></span>
        <span>API <b>NOT CONNECTED</b></span>
        <em>UI CHECKPOINT 0.6</em>
      </footer>
    </main>
  );
}

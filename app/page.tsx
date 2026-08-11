"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {createNightRegion, getSolarState, solarElevation} from "./solar";

const MOCK_SAT = {
  name: "WORLDSAT-01",
  norad: "99001",
  lat: 18.4,
  lon: 32.7,
  altitude: 547,
  heading: 74,
};

const INITIAL_VIEW = { center: [13, 18] as [number, number], zoom: 1.35, bearing: 0, pitch: 0 };
const OPENFREEMAP_DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const CARTO_DARK_TILES = [
  "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
];
const OSM_STANDARD_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ROTATION_DEGREES_PER_SECOND = 0.6;
const ROTATION_RESUME_DELAY_MS = 4_000;
const INITIAL_UTC = new Date("2000-01-01T12:00:00.000Z");

type Basemap = "dark" | "street" | "satellite";
type SceneOptions = {sky: boolean; nightShadow: boolean};

function headingEndpoint(lon: number, lat: number, heading: number, distanceKm: number): [number, number] {
  const angularDistance = distanceKm / 6371;
  const bearing = heading * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
}

type MutableStyleLayer = {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
};

async function loadStyle(mode: Basemap): Promise<StyleSpecification> {
  if (mode === "dark") {
    return {
      version: 8,
      projection: { type: "globe" },
      sources: {
        "carto-dark": {
          type: "raster",
          tiles: CARTO_DARK_TILES,
          tileSize: 256,
          maxzoom: 20,
          attribution: "© OpenStreetMap contributors © CARTO",
        },
      },
      layers: [{ id: "carto-dark", type: "raster", source: "carto-dark" }],
    };
  }

  if (mode === "street") {
    return {
      version: 8,
      projection: { type: "globe" },
      sources: {
        "osm-standard": {
          type: "raster",
          tiles: [OSM_STANDARD_TILES],
          tileSize: 256,
          maxzoom: 19,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [{ id: "osm-standard", type: "raster", source: "osm-standard" }],
    };
  }

  const response = await fetch(OPENFREEMAP_DARK_STYLE_URL);
  if (!response.ok) throw new Error(`OpenFreeMap dark style unavailable (${response.status})`);
  const style = await response.json() as StyleSpecification;
  style.projection = { type: "globe" };

  if (mode === "satellite") {
    style.sources = {
      "satellite-imagery": {
        type: "raster",
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Tiles © Esri and data providers",
      },
      ...style.sources,
    };
    style.layers = [
      {
        id: "satellite-imagery",
        type: "raster",
        source: "satellite-imagery",
      },
      ...style.layers.map((rawLayer) => {
        const layer = rawLayer as MutableStyleLayer;
        if (layer.type !== "background" && layer.type !== "fill" && layer.type !== "fill-extrusion") return rawLayer;
        return { ...rawLayer, layout: { ...rawLayer.layout, visibility: "none" as const } };
      }),
    ];
  }

  return style;
}

function fallbackStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      "osm-fallback": {
        type: "raster",
        tiles: [OSM_STANDARD_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#02080d" } },
      {
        id: "osm-fallback",
        type: "raster",
        source: "osm-fallback",
      },
    ],
  };
}

function addMissionLayers(map: MapLibreMap) {
  if (!map.getSource("heading-vector")) {
    map.addSource("heading-vector", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [MOCK_SAT.lon, MOCK_SAT.lat],
            headingEndpoint(MOCK_SAT.lon, MOCK_SAT.lat, MOCK_SAT.heading, 1750),
          ],
        },
      },
    });
  }
  if (!map.getLayer("mock-heading")) {
    map.addLayer({
      id: "mock-heading",
      type: "line",
      source: "heading-vector",
      paint: {
        "line-color": "#66f0ad",
        "line-width": 2,
        "line-dasharray": [3, 3],
        "line-opacity": 0.95,
      },
    });
  }
}

function applySky(map: MapLibreMap, enabled: boolean) {
  map.setSky(enabled ? {
    "sky-color": "rgba(1, 6, 14, 0.42)",
    "horizon-color": "rgba(24, 68, 91, 0.34)",
    "fog-color": "rgba(14, 42, 59, 0.24)",
    "sky-horizon-blend": 0.58,
    "horizon-fog-blend": 0.42,
    "fog-ground-blend": 0.15,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.16, 4, 0.05, 7, 0],
  } : {
    "sky-color": "rgba(0, 0, 0, 0)",
    "horizon-color": "rgba(0, 0, 0, 0)",
    "fog-color": "rgba(0, 0, 0, 0)",
    "fog-ground-blend": 0,
    "horizon-fog-blend": 0,
    "sky-horizon-blend": 0,
    "atmosphere-blend": 0,
  });
}

function syncNightShadow(map: MapLibreMap, enabled: boolean, date = new Date()) {
  const source = map.getSource("night-region") as GeoJSONSource | undefined;
  if (!enabled) {
    if (map.getLayer("night-shadow")) map.removeLayer("night-shadow");
    if (source) map.removeSource("night-region");
    return;
  }

  const nightRegion = createNightRegion(date);
  if (source) {
    source.setData(nightRegion);
  } else {
    map.addSource("night-region", {type: "geojson", data: nightRegion});
  }
  if (!map.getLayer("night-shadow")) {
    map.addLayer({
      id: "night-shadow",
      type: "fill",
      source: "night-region",
      paint: {
        "fill-color": "#01040b",
        "fill-opacity": 0.64,
        "fill-antialias": false,
      },
    });
  }
}

function Globe({
  resetKey,
  basemap,
  scene,
  followSatellite,
  onCameraChange,
  onMapState,
  onSelectSatellite,
}: {
  resetKey: number;
  basemap: Basemap;
  scene: SceneOptions;
  followSatellite: boolean;
  onCameraChange: (longitude: number, latitude: number, zoom: number) => void;
  onMapState: (state: "loading" | "ready" | "fallback") => void;
  onSelectSatellite: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleRequestRef = useRef(0);
  const basemapRef = useRef<Basemap>(basemap);
  const sceneRef = useRef(scene);
  const followRef = useRef(followSatellite);
  const selectSatelliteRef = useRef(onSelectSatellite);

  useEffect(() => { sceneRef.current = scene; }, [scene]);
  useEffect(() => { followRef.current = followSatellite; }, [followSatellite]);
  useEffect(() => { selectSatelliteRef.current = onSelectSatellite; }, [onSelectSatellite]);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    let animationFrame = 0;
    let lastFrame = performance.now();
    let lastCameraReport = 0;
    let rotationPausedUntil = 0;
    let nightTimer = 0;
    let markerNode: HTMLDivElement | null = null;
    let markerRenderListener: (() => void) | null = null;

    void Promise.all([import("maplibre-gl"), loadStyle(basemapRef.current).catch(() => fallbackStyle())]).then(([maplibre, style]) => {
      if (disposed || !containerRef.current) return;
      map = new maplibre.Map({
        container: containerRef.current,
        center: INITIAL_VIEW.center,
        zoom: INITIAL_VIEW.zoom,
        bearing: INITIAL_VIEW.bearing,
        pitch: INITIAL_VIEW.pitch,
        minZoom: 0,
        maxZoom: 18,
        attributionControl: false,
        renderWorldCopies: false,
        style,
      });
      mapRef.current = map;

      map.on("style.load", () => {
        if (!map) return;
        map.setProjection({ type: "globe" });
        applySky(map, sceneRef.current.sky);
        syncNightShadow(map, sceneRef.current.nightShadow);
        addMissionLayers(map);
        onMapState("ready");
      });
      map.on("error", () => onMapState("fallback"));

      markerRenderListener = () => {
        if (!map || markerNode || !map.isStyleLoaded()) return;
        const node = document.createElement("div");
        node.className = "satellite-marker";
        node.setAttribute("role", "button");
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", `Follow ${MOCK_SAT.name}, mock satellite at ${MOCK_SAT.lat} north, ${MOCK_SAT.lon} east`);
        node.innerHTML = `<span class="satellite-pulse"></span><span class="satellite-core"></span><span class="satellite-label"><b>${MOCK_SAT.name}</b><small>${MOCK_SAT.heading}° HEADING</small></span>`;
        const selectSatellite = () => selectSatelliteRef.current();
        node.addEventListener("click", selectSatellite);
        node.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectSatellite();
          }
        });
        try {
          new maplibre.Marker({ element: node, anchor: "center" })
            .setLngLat([MOCK_SAT.lon, MOCK_SAT.lat])
            .addTo(map);
          markerNode = node;
          map.off("render", markerRenderListener!);
          markerRenderListener = null;
        } catch {
          node.remove();
        }
      };
      map.on("render", markerRenderListener);

      const reportCamera = () => {
        if (!map) return;
        const now = performance.now();
        if (now - lastCameraReport < 180) return;
        lastCameraReport = now;
        const center = map.getCenter();
        onCameraChange(center.lng, center.lat, map.getZoom());
      };
      map.on("move", reportCamera);
      reportCamera();

      const pauseRotation = () => { rotationPausedUntil = performance.now() + ROTATION_RESUME_DELAY_MS; };
      const canvas = map.getCanvasContainer();
      canvas.addEventListener("pointerdown", pauseRotation);
      canvas.addEventListener("wheel", pauseRotation, {passive: true});
      canvas.addEventListener("touchstart", pauseRotation, {passive: true});

      const rotate = (timestamp: number) => {
        if (!map || disposed) return;
        const elapsedSeconds = Math.min((timestamp - lastFrame) / 1000, 0.1);
        lastFrame = timestamp;
        if (!followRef.current && timestamp >= rotationPausedUntil && !map.isMoving()) {
          const center = map.getCenter();
          map.jumpTo({center: [center.lng + ROTATION_DEGREES_PER_SECOND * elapsedSeconds, center.lat]});
        }
        animationFrame = requestAnimationFrame(rotate);
      };
      animationFrame = requestAnimationFrame(rotate);
      nightTimer = window.setInterval(() => {
        if (map?.isStyleLoaded() && sceneRef.current.nightShadow) syncNightShadow(map, true);
      }, 60_000);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      window.clearInterval(nightTimer);
      if (map && markerRenderListener) map.off("render", markerRenderListener);
      markerNode?.remove();
      map?.remove();
      mapRef.current = null;
    };
  }, [onCameraChange, onMapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapRef.current === basemap) return;

    basemapRef.current = basemap;
    const requestId = ++styleRequestRef.current;
    onMapState("loading");
    void loadStyle(basemap)
      .then((style) => {
        if (requestId === styleRequestRef.current && mapRef.current) mapRef.current.setStyle(style);
      })
      .catch(() => {
        if (requestId === styleRequestRef.current && mapRef.current) {
          mapRef.current.setStyle(fallbackStyle());
          onMapState("fallback");
        }
      });
  }, [basemap, onMapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    applySky(map, scene.sky);
    syncNightShadow(map, scene.nightShadow);
    addMissionLayers(map);
  }, [scene]);

  useEffect(() => {
    if (!followSatellite) return;
    mapRef.current?.easeTo({center: [MOCK_SAT.lon, MOCK_SAT.lat], zoom: Math.max(mapRef.current.getZoom(), 2.4), duration: 900});
  }, [followSatellite]);

  useEffect(() => {
    if (resetKey === 0) return;
    mapRef.current?.easeTo({ ...INITIAL_VIEW, duration: 850 });
  }, [resetKey]);

  return <div ref={containerRef} className="globe-map" aria-label="Interactive rotating 3D Earth map showing one mock satellite" />;
}

function MapSettingsPanel({ basemap, scene, onBasemapChange, onSceneChange, onClose }: {
  basemap: Basemap;
  scene: SceneOptions;
  onBasemapChange: (next: Basemap) => void;
  onSceneChange: (key: keyof SceneOptions, enabled: boolean) => void;
  onClose: () => void;
}) {
  return <aside className="settings-panel" aria-label="Map settings">
    <div className="settings-head"><div><small>DISPLAY CONTROL</small><h2>MAP SETTINGS</h2></div><button onClick={onClose} aria-label="Close map settings">×</button></div>
    <section><h3>BASEMAP</h3><div className="basemap-options">
      {(["dark", "street", "satellite"] as Basemap[]).map((mode) => <button
        key={mode}
        className={basemap === mode ? "selected" : ""}
        onClick={() => onBasemapChange(mode)}
        aria-pressed={basemap === mode}
      ><i className={`basemap-swatch ${mode}`}/><span>{mode.toUpperCase()}</span></button>)}
    </div></section>
    <section><h3>SPACE ENVIRONMENT</h3><div className="scene-options">
      <button className="scene-toggle" role="switch" aria-checked={scene.sky} onClick={() => onSceneChange("sky", !scene.sky)}>
        <span><b>SKY + SUN</b><small>STARFIELD / UTC SOLAR POSITION</small></span><i className={scene.sky ? "enabled" : ""}/>
      </button>
      <button className="scene-toggle" role="switch" aria-checked={scene.nightShadow} onClick={() => onSceneChange("nightShadow", !scene.nightShadow)}>
        <span><b>NIGHT SHADOW</b><small>LIVE UTC SOLAR TERMINATOR</small></span><i className={scene.nightShadow ? "enabled" : ""}/>
      </button>
    </div></section>
    <div className="rotation-state"><span>PLANET ROTATION</span><b>ALWAYS ON · {ROTATION_DEGREES_PER_SECOND.toFixed(1)}°/S</b></div>
  </aside>;
}

export default function Home() {
  const [resetKey, setResetKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapState, setMapState] = useState<"loading" | "ready" | "fallback">("loading");
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [scene, setScene] = useState<SceneOptions>({sky: true, nightShadow: true});
  const [followSatellite, setFollowSatellite] = useState(false);
  const [now, setNow] = useState(INITIAL_UTC);
  const [camera, setCamera] = useState({ longitude: INITIAL_VIEW.center[0], latitude: INITIAL_VIEW.center[1], zoom: INITIAL_VIEW.zoom });

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  const sun = useMemo(() => getSolarState(now), [now]);
  const satelliteSunElevation = solarElevation(MOCK_SAT.lat, MOCK_SAT.lon, sun);
  const relativeSunLongitude = ((sun.longitude - camera.longitude + 540) % 360) - 180;
  const skyStyle = {
    "--sun-x": `${50 + 43 * Math.sin(relativeSunLongitude * Math.PI / 180)}%`,
    "--sun-y": `${48 - 31 * Math.sin((sun.latitude - camera.latitude * 0.35) * Math.PI / 180)}%`,
    "--stars-far-x": `${-camera.longitude * 1.8}px`,
    "--stars-far-y": `${camera.latitude * 1.1}px`,
    "--stars-near-x": `${-camera.longitude * 3.4}px`,
    "--stars-near-y": `${camera.latitude * 2.1}px`,
  } as CSSProperties;

  const handleCameraChange = useCallback((longitude: number, latitude: number, zoom: number) => {
    setCamera({ longitude, latitude, zoom });
  }, []);
  const handleMapState = useCallback((state: "loading" | "ready" | "fallback") => setMapState(state), []);
  const handleSceneChange = useCallback((key: keyof SceneOptions, enabled: boolean) => {
    setScene((current) => ({...current, [key]: enabled}));
  }, []);
  const handleSelectSatellite = useCallback(() => setFollowSatellite(true), []);
  const handleReset = useCallback(() => {
    setFollowSatellite(false);
    setResetKey((key) => key + 1);
  }, []);

  return <main className="monitor-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"/><div><strong>WORLDSAT</strong><small>MISSION MONITOR</small></div></div>
      <div className="topbar-actions">
        <div className="system-state"><span/> MOCK DATA <b>UTC {now === INITIAL_UTC ? "--:--:--" : now.toISOString().slice(11, 19)}</b></div>
        <button className={`settings-trigger ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-label="Open map settings"><i/><span>MAP SETTINGS</span></button>
      </div>
    </header>
    <section className="viewport">
      <div className={`space-sky ${scene.sky ? "visible" : ""}`} style={skyStyle} aria-hidden="true">
        <span className="starfield stars-far"/>
        <span className="starfield stars-near"/>
        <span className="sun-disc"/>
      </div>
      <Globe resetKey={resetKey} basemap={basemap} scene={scene} followSatellite={followSatellite} onCameraChange={handleCameraChange} onMapState={handleMapState} onSelectSatellite={handleSelectSatellite}/>
      <div className="eyebrow">ORBITAL VIEW / EARTH DETAIL</div>
      <div className="coordinates">{formatCoordinate(camera.latitude, "N", "S")}&nbsp;&nbsp; {formatCoordinate(camera.longitude, "E", "W")}&nbsp;&nbsp; Z{camera.zoom.toFixed(1)}</div>
      {settingsOpen && (
        <MapSettingsPanel basemap={basemap} scene={scene} onBasemapChange={setBasemap} onSceneChange={handleSceneChange} onClose={() => setSettingsOpen(false)}/>
      )}
      <aside className="sat-card">
        <div className="card-head"><span className="status-dot"/><div><small>ACTIVE OBJECT</small><h1>{MOCK_SAT.name}</h1></div><b>MOCK</b></div>
        <dl><div><dt>ALTITUDE</dt><dd>{MOCK_SAT.altitude} <small>km</small></dd></div><div><dt>HEADING</dt><dd>{MOCK_SAT.heading}.0°</dd></div><div><dt>LATITUDE</dt><dd>+{MOCK_SAT.lat.toFixed(3)}°</dd></div><div><dt>LONGITUDE</dt><dd>+{MOCK_SAT.lon.toFixed(3)}°</dd></div></dl>
        <div className="data-row"><span>NORAD ID</span><b>{MOCK_SAT.norad}</b></div>
        <div className="data-row"><span>BASEMAP</span><b>{basemap.toUpperCase()}</b></div>
        <div className="data-row"><span>ILLUMINATION</span><b className={satelliteSunElevation >= 0 ? "daylight" : "nighttime"}>{satelliteSunElevation >= 0 ? "DAYLIGHT" : "NIGHT"}</b></div>
        <button className={`follow-button ${followSatellite ? "active" : ""}`} onClick={() => setFollowSatellite((active) => !active)} aria-pressed={followSatellite}>{followSatellite ? "FOLLOWING SATELLITE" : "FOLLOW SATELLITE"}</button>
      </aside>
      <div className="map-credit">{basemap === "satellite" ? <>Imagery © <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a> & providers · Overlays © OpenStreetMap</> : basemap === "street" ? <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></> : <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a></>}</div>
      <div className="legend"><span><i className="sat-symbol"/> SATELLITE</span><span><i className="vector-symbol"/> HEADING VECTOR</span></div>
      <div className="controls"><span>{followSatellite ? "CAMERA LOCKED TO SATELLITE" : "AUTO ROTATION ACTIVE"}</span><span>DRAG PAUSES ROTATION</span><button onClick={handleReset} aria-label="Reset globe camera">RESET VIEW</button></div>
    </section>
    <footer><span>1 OBJECT TRACKED</span><span>MAP <b className={mapState === "ready" ? "online" : ""}>{mapState.toUpperCase()}</b></span><span>SKY <b className={scene.sky ? "online" : ""}>{scene.sky ? "UTC LIVE" : "OFF"}</b></span><span>API <b>NOT CONNECTED</b></span><em>UI CHECKPOINT 0.4</em></footer>
  </main>;
}

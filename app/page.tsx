"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
const CARTO_DARK_STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const OSM_STANDARD_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

type Basemap = "dark" | "street" | "satellite";
type LayerKey = "roads" | "borders" | "places" | "water" | "buildings";
type MapSettings = { basemap: Basemap } & Record<LayerKey, boolean>;

const DEFAULT_SETTINGS: MapSettings = {
  basemap: "dark",
  roads: true,
  borders: true,
  places: true,
  water: true,
  buildings: false,
};

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
  source?: string;
  "source-layer"?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

function layerCategory(layer: MutableStyleLayer): LayerKey | null {
  const name = `${layer.id} ${layer["source-layer"] ?? ""}`.toLowerCase();
  if (/building|housenumber/.test(name)) return "buildings";
  if (/boundary|admin|border/.test(name)) return "borders";
  if (/road|street|highway|motorway|trunk|bridge|tunnel|path|rail|transportation/.test(name)) return "roads";
  if (/place|label|city|town|village|settlement|poi|airport|aerodrome/.test(name) ||
      (layer.type === "symbol" && layer.layout?.["text-field"])) return "places";
  if (/water|ocean|sea|river|lake|stream|waterway/.test(name)) return "water";
  return null;
}

async function loadStyle(mode: Basemap): Promise<StyleSpecification> {
  if (mode === "dark") {
    const response = await fetch(CARTO_DARK_STYLE_URL);
    if (!response.ok) throw new Error(`CARTO Dark Matter style unavailable (${response.status})`);
    const style = await response.json() as StyleSpecification;
    style.projection = { type: "globe" };
    return style;
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
    for (const rawLayer of style.layers) {
      const layer = rawLayer as MutableStyleLayer;
      layer.metadata = { ...layer.metadata, "worldsat:category": layerCategory(layer) };
    }
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

function applyLayerSettings(map: MapLibreMap, settings: MapSettings) {
  if (settings.basemap === "street") return;
  const layers = map.getStyle().layers ?? [];
  for (const rawLayer of layers) {
    const layer = rawLayer as MutableStyleLayer;
    if (layer.id === "mock-heading" || layer.id === "satellite-imagery") continue;
    const category = (layer.metadata?.["worldsat:category"] as LayerKey | null | undefined) ?? layerCategory(layer);
    if (!category) continue;
    const hidesSatelliteImagery = settings.basemap === "satellite" &&
      (layer.type === "background" || layer.type === "fill" || layer.type === "fill-extrusion");
    map.setLayoutProperty(layer.id, "visibility", hidesSatelliteImagery || !settings[category] ? "none" : "visible");
  }
}

function Globe({
  resetKey,
  settings,
  onCameraChange,
  onMapState,
}: {
  resetKey: number;
  settings: MapSettings;
  onCameraChange: (longitude: number, latitude: number, zoom: number) => void;
  onMapState: (state: "loading" | "ready" | "fallback") => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const settingsRef = useRef(settings);
  const styleRequestRef = useRef(0);
  const basemapRef = useRef<Basemap>(settings.basemap);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;

    void Promise.all([import("maplibre-gl"), loadStyle(settingsRef.current.basemap).catch(() => fallbackStyle())]).then(([maplibre, style]) => {
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
        map.setSky({ "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.07, 4, 0.025, 7, 0] });
        addMissionLayers(map);
        applyLayerSettings(map, settingsRef.current);
        onMapState("ready");
      });
      map.on("error", () => onMapState("fallback"));

      const markerNode = document.createElement("div");
      markerNode.className = "satellite-marker";
      markerNode.setAttribute("role", "img");
      markerNode.setAttribute("aria-label", `${MOCK_SAT.name}, mock satellite at ${MOCK_SAT.lat} north, ${MOCK_SAT.lon} east`);
      markerNode.innerHTML = `<span class="satellite-pulse"></span><span class="satellite-core"></span><span class="satellite-label"><b>${MOCK_SAT.name}</b><small>${MOCK_SAT.heading}° HEADING</small></span>`;
      new maplibre.Marker({ element: markerNode, anchor: "center" })
        .setLngLat([MOCK_SAT.lon, MOCK_SAT.lat])
        .addTo(map);

      const reportCamera = () => {
        if (!map) return;
        const center = map.getCenter();
        onCameraChange(center.lng, center.lat, map.getZoom());
      };
      map.on("move", reportCamera);
      reportCamera();
    });

    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, [onCameraChange, onMapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    settingsRef.current = settings;
    if (basemapRef.current === settings.basemap) {
      if (map.isStyleLoaded()) applyLayerSettings(map, settings);
      return;
    }

    basemapRef.current = settings.basemap;
    const requestId = ++styleRequestRef.current;
    onMapState("loading");
    void loadStyle(settings.basemap)
      .then((style) => {
        if (requestId === styleRequestRef.current && mapRef.current) mapRef.current.setStyle(style);
      })
      .catch(() => {
        if (requestId === styleRequestRef.current && mapRef.current) {
          mapRef.current.setStyle(fallbackStyle());
          onMapState("fallback");
        }
      });
  }, [settings, onMapState]);

  useEffect(() => {
    if (resetKey === 0) return;
    mapRef.current?.easeTo({ ...INITIAL_VIEW, duration: 850 });
  }, [resetKey]);

  return <div ref={containerRef} className="globe-map" aria-label="Interactive 3D Earth map showing one mock satellite" />;
}

function MapSettingsPanel({ settings, onChange, onClose }: {
  settings: MapSettings;
  onChange: (next: MapSettings) => void;
  onClose: () => void;
}) {
  const toggles: Array<[LayerKey, string, string]> = [
    ["roads", "Roads", "Road and transport network"],
    ["borders", "Borders", "Country and regional boundaries"],
    ["places", "Places", "Countries, cities and POIs"],
    ["water", "Water", "Oceans, lakes and rivers"],
    ["buildings", "Buildings", "Building footprints at close zoom"],
  ];

  const detailsAvailable = settings.basemap !== "street";

  return <aside className="settings-panel" aria-label="Map settings">
    <div className="settings-head"><div><small>DISPLAY CONTROL</small><h2>MAP SETTINGS</h2></div><button onClick={onClose} aria-label="Close map settings">×</button></div>
    <section><h3>BASEMAP</h3><div className="basemap-options">
      {(["dark", "street", "satellite"] as Basemap[]).map((mode) => <button
        key={mode}
        className={settings.basemap === mode ? "selected" : ""}
        onClick={() => onChange({ ...settings, basemap: mode })}
        aria-pressed={settings.basemap === mode}
      ><i className={`basemap-swatch ${mode}`}/><span>{mode.toUpperCase()}</span></button>)}
    </div></section>
    <section><h3>MAP DETAILS</h3><div className="layer-options">
      {toggles.map(([key, label, description]) => <label key={key} className={!detailsAvailable ? "disabled" : ""}>
        <span><b>{label}</b><small>{description}</small></span>
        <input type="checkbox" checked={settings[key]} disabled={!detailsAvailable} onChange={(event) => onChange({ ...settings, [key]: event.target.checked })}/>
        <i aria-hidden="true"/>
      </label>)}
    </div></section>
    <p>{detailsAvailable
      ? "Map details are separate vector layers. Only visible tiles are streamed."
      : "The OpenStreetMap Standard layer is a rendered image, so its details cannot be switched independently."}</p>
  </aside>;
}

export default function Home() {
  const [resetKey, setResetKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapState, setMapState] = useState<"loading" | "ready" | "fallback">("loading");
  const [settings, setSettings] = useState<MapSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
      const saved = window.localStorage.getItem("worldsat-map-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [camera, setCamera] = useState({ longitude: INITIAL_VIEW.center[0], latitude: INITIAL_VIEW.center[1], zoom: INITIAL_VIEW.zoom });

  const updateSettings = useCallback((next: MapSettings) => {
    setSettings(next);
    try { window.localStorage.setItem("worldsat-map-settings", JSON.stringify(next)); } catch { /* no-op */ }
  }, []);
  const handleCameraChange = useCallback((longitude: number, latitude: number, zoom: number) => {
    setCamera({ longitude, latitude, zoom });
  }, []);
  const handleMapState = useCallback((state: "loading" | "ready" | "fallback") => setMapState(state), []);

  return <main className="monitor-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"/><div><strong>WORLDSAT</strong><small>MISSION MONITOR</small></div></div>
      <div className="topbar-actions">
        <div className="system-state"><span/> MOCK DATA <b>UTC 18:42:16</b></div>
        <button className={`settings-trigger ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-label="Open map settings"><i/><span>MAP SETTINGS</span></button>
      </div>
    </header>
    <section className="viewport">
      <Globe resetKey={resetKey} settings={settings} onCameraChange={handleCameraChange} onMapState={handleMapState}/>
      <div className="eyebrow">ORBITAL VIEW / EARTH DETAIL</div>
      <div className="coordinates">{formatCoordinate(camera.latitude, "N", "S")}&nbsp;&nbsp; {formatCoordinate(camera.longitude, "E", "W")}&nbsp;&nbsp; Z{camera.zoom.toFixed(1)}</div>
      {settingsOpen && <MapSettingsPanel settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)}/>} 
      <aside className="sat-card">
        <div className="card-head"><span className="status-dot"/><div><small>ACTIVE OBJECT</small><h1>{MOCK_SAT.name}</h1></div><b>MOCK</b></div>
        <dl><div><dt>ALTITUDE</dt><dd>{MOCK_SAT.altitude} <small>km</small></dd></div><div><dt>HEADING</dt><dd>{MOCK_SAT.heading}.0°</dd></div><div><dt>LATITUDE</dt><dd>+{MOCK_SAT.lat.toFixed(3)}°</dd></div><div><dt>LONGITUDE</dt><dd>+{MOCK_SAT.lon.toFixed(3)}°</dd></div></dl>
        <div className="data-row"><span>NORAD ID</span><b>{MOCK_SAT.norad}</b></div>
        <div className="data-row"><span>BASEMAP</span><b>{settings.basemap.toUpperCase()}</b></div>
      </aside>
      <div className="map-credit">{settings.basemap === "satellite" ? <>Imagery © <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a> & providers · Overlays © OpenStreetMap</> : settings.basemap === "street" ? <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></> : <>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a></>}</div>
      <div className="legend"><span><i className="sat-symbol"/> SATELLITE</span><span><i className="vector-symbol"/> HEADING VECTOR</span></div>
      <div className="controls"><span>DRAG TO ROTATE</span><span>SCROLL TO ZOOM</span><button onClick={() => setResetKey((key) => key + 1)} aria-label="Reset globe camera">RESET VIEW</button></div>
    </section>
    <footer><span>1 OBJECT TRACKED</span><span>MAP <b className={mapState === "ready" ? "online" : ""}>{mapState.toUpperCase()}</b></span><span>API <b>NOT CONNECTED</b></span><em>UI CHECKPOINT 0.3</em></footer>
  </main>;
}

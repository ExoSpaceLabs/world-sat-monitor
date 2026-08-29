"use client";

import {useEffect, useRef} from "react";
import type {Map as MapLibreMap, Marker as MapLibreMarker} from "maplibre-gl";
import {DEFAULT_APP_SETTINGS, type OrbitDisplaySettings} from "../../domain/settings";
import type {MapSession} from "../../domain/types";
import {usesStreetContrast} from "../../maps/theme";
import {getAppSettings} from "../../services/worldsat-api";
import {
  headingEndpoint,
  isSatelliteOccluded,
  type GlobeVector,
  type Satellite,
  type SatelliteTrackPoint,
} from "../../domain/satellite";
import {ORBIT_DISPLAY_CHANGE_EVENT} from "./OrbitSettingsPanel";
import {
  OrbitTrackLayer,
  ORBIT_TRACK_LAYER_ID,
  type OrbitDebugState,
} from "./OrbitTrackLayer";
import {
  isSatelliteOverEarthDisk,
  projectSatelliteScreenPosition,
} from "./satelliteProjection";

const DIRECTION_VECTOR_LENGTH_KM = 650;

type MarkerElements = {
  heading: HTMLElement;
  name: HTMLElement;
  node: HTMLButtonElement;
  visual: HTMLElement;
};

function createMarkerNode(onSelect: () => void): MarkerElements {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "satellite-marker";

  const visual = document.createElement("span");
  visual.className = "satellite-visual";
  const pulse = document.createElement("span");
  pulse.className = "satellite-pulse";
  const core = document.createElement("span");
  core.className = "satellite-core";
  const label = document.createElement("span");
  label.className = "satellite-label";
  const name = document.createElement("b");
  const heading = document.createElement("small");
  label.append(name, heading);
  visual.append(pulse, core, label);
  node.append(visual);
  node.addEventListener("click", onSelect);
  return {heading, name, node, visual};
}

function getGlobeCameraPosition(map: MapLibreMap): GlobeVector | null {
  const transform = map._camera.transform;
  if (!transform.getClippingPlane()) return null;
  const camera = transform.cameraPosition;
  return [camera[0], camera[1], camera[2]];
}

function placedSatellite(satellite: Satellite, settings: OrbitDisplaySettings): Satellite {
  return settings.path.mode === "ground"
    ? {...satellite, altitude: 0}
    : satellite;
}

function trackLayerSettings(settings: OrbitDisplaySettings): OrbitDisplaySettings {
  return {...settings, direction_vector_enabled: false};
}

function updateMarkerPresentation(
  map: MapLibreMap,
  maplibre: MapSession["maplibre"],
  elements: MarkerElements,
  satellite: Satellite,
  settings: OrbitDisplaySettings,
) {
  const displaySatellite = placedSatellite(satellite, settings);
  const surfacePoint = map.project([displaySatellite.lon, displaySatellite.lat]);
  const satellitePoint = projectSatelliteScreenPosition(map, maplibre, displaySatellite);
  if (satellitePoint) {
    elements.visual.style.transform = `translate3d(${(satellitePoint.x - surfacePoint.x).toFixed(2)}px,${(satellitePoint.y - surfacePoint.y).toFixed(2)}px,0)`;
  } else {
    elements.visual.style.transform = "translate3d(0,0,0)";
  }

  const cameraPosition = getGlobeCameraPosition(map);
  const occluded = cameraPosition
    ? isSatelliteOccluded(displaySatellite, cameraPosition)
    : false;
  const street = usesStreetContrast(map);
  const overEarth = isSatelliteOverEarthDisk(map, displaySatellite);
  elements.node.classList.toggle("street-surface", street && overEarth);
  elements.node.classList.toggle("street-space", street && !overEarth);
  elements.node.classList.toggle("occluded", occluded);
  elements.node.dataset.visibility = occluded ? "occluded" : "visible";
}

function installationFailure(error: unknown): OrbitDebugState {
  return {
    error: error instanceof Error ? error.message : String(error),
    headingVertices: 0,
    historyVertices: 0,
    predictionVertices: 0,
    ready: false,
    shaderVariant: "INSTALL",
  };
}

type SatelliteLayerProps = {
  mapSession: MapSession | null;
  satellite: Satellite;
  track: SatelliteTrackPoint[];
  selected: boolean;
  onSelect: () => void;
  onDebugState?: (state: OrbitDebugState) => void;
};

export function SatelliteLayer({
  mapSession,
  satellite,
  track,
  selected,
  onSelect,
  onDebugState,
}: SatelliteLayerProps) {
  const map = mapSession?.map;
  const maplibre = mapSession?.maplibre;
  const Marker = maplibre?.Marker;
  const elementsRef = useRef<MarkerElements | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const trackLayerRef = useRef<OrbitTrackLayer | null>(null);
  const vectorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestSatelliteRef = useRef(satellite);
  const latestTrackRef = useRef(track);
  const orbitSettingsRef = useRef<OrbitDisplaySettings>(DEFAULT_APP_SETTINGS.orbit);

  useEffect(() => {
    latestSatelliteRef.current = satellite;
    trackLayerRef.current?.update({
      satellite,
      settings: trackLayerSettings(orbitSettingsRef.current),
      track: latestTrackRef.current,
    });
    map?.triggerRepaint();
  }, [map, satellite]);

  useEffect(() => {
    latestTrackRef.current = track;
    trackLayerRef.current?.update({
      satellite: latestSatelliteRef.current,
      settings: trackLayerSettings(orbitSettingsRef.current),
      track,
    });
    map?.triggerRepaint();
  }, [map, track]);

  useEffect(() => {
    let cancelled = false;
    void getAppSettings().then((settings) => {
      if (cancelled) return;
      orbitSettingsRef.current = settings.orbit;
      trackLayerRef.current?.update({
        satellite: latestSatelliteRef.current,
        settings: trackLayerSettings(settings.orbit),
        track: latestTrackRef.current,
      });
      map?.triggerRepaint();
    }).catch(() => undefined);

    const handleDisplayChange = (event: Event) => {
      const custom = event as CustomEvent<OrbitDisplaySettings>;
      orbitSettingsRef.current = custom.detail;
      trackLayerRef.current?.update({
        satellite: latestSatelliteRef.current,
        settings: trackLayerSettings(custom.detail),
        track: latestTrackRef.current,
      });
      map?.triggerRepaint();
    };
    window.addEventListener(ORBIT_DISPLAY_CHANGE_EVENT, handleDisplayChange);
    return () => {
      cancelled = true;
      window.removeEventListener(ORBIT_DISPLAY_CHANGE_EVENT, handleDisplayChange);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !maplibre || !Marker) return;
    const elements = createMarkerNode(onSelect);
    const marker = new Marker({
      element: elements.node,
      anchor: "center",
      opacity: 1,
      opacityWhenCovered: 1,
      subpixelPositioning: true,
    })
      .setLngLat([latestSatelliteRef.current.lon, latestSatelliteRef.current.lat])
      .addTo(map);
    elementsRef.current = elements;
    markerRef.current = marker;

    const update = () => updateMarkerPresentation(
      map,
      maplibre,
      elements,
      latestSatelliteRef.current,
      orbitSettingsRef.current,
    );
    map.on("render", update);
    update();

    return () => {
      map.off("render", update);
      marker.remove();
      if (elementsRef.current === elements) elementsRef.current = null;
      if (markerRef.current === marker) markerRef.current = null;
    };
  }, [Marker, map, maplibre, onSelect]);

  useEffect(() => {
    const elements = elementsRef.current;
    const marker = markerRef.current;
    if (!map || !maplibre || !elements || !marker) return;
    elements.name.textContent = satellite.name;
    elements.heading.textContent = `${satellite.heading.toFixed(1)}° HEADING · ${satellite.altitude.toFixed(1)} KM`;
    elements.node.classList.toggle("selected", selected);
    elements.node.setAttribute("aria-label", `Select and follow ${satellite.name}`);
    marker.setLngLat([satellite.lon, satellite.lat]);
    updateMarkerPresentation(map, maplibre, elements, satellite, orbitSettingsRef.current);
  }, [map, maplibre, satellite, selected]);

  useEffect(() => {
    if (!mapSession) return;
    const map = mapSession.map;
    const layer = new OrbitTrackLayer(
      {
        satellite: latestSatelliteRef.current,
        settings: trackLayerSettings(orbitSettingsRef.current),
        track: latestTrackRef.current,
      },
      mapSession.maplibre,
      onDebugState,
    );
    trackLayerRef.current = layer;

    try {
      if (map.getLayer(ORBIT_TRACK_LAYER_ID)) map.removeLayer(ORBIT_TRACK_LAYER_ID);
      map.addLayer(layer);
    } catch (error) {
      onDebugState?.(installationFailure(error));
      console.error("Unable to install orbit-track layer", error);
    }

    return () => {
      if (map.getLayer(ORBIT_TRACK_LAYER_ID)) map.removeLayer(ORBIT_TRACK_LAYER_ID);
      if (trackLayerRef.current === layer) trackLayerRef.current = null;
    };
  }, [mapSession, onDebugState]);

  useEffect(() => {
    if (!mapSession) return;
    const {map, maplibre} = mapSession;
    const canvas = vectorCanvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const width = map.getCanvas().clientWidth;
      const height = map.getCanvas().clientHeight;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const settings = orbitSettingsRef.current;
      if (!settings.direction_vector_enabled) return;
      const displaySatellite = placedSatellite(latestSatelliteRef.current, settings);
      const camera = getGlobeCameraPosition(map);
      if (camera && isSatelliteOccluded(displaySatellite, camera)) return;

      const start = projectSatelliteScreenPosition(map, maplibre, displaySatellite);
      if (!start) return;
      const [endLon, endLat] = headingEndpoint(
        displaySatellite.lon,
        displaySatellite.lat,
        displaySatellite.heading,
        DIRECTION_VECTOR_LENGTH_KM,
      );
      const end = projectSatelliteScreenPosition(map, maplibre, {
        ...displaySatellite,
        lon: endLon,
        lat: endLat,
      });
      if (!end) return;

      context.beginPath();
      context.setLineDash([4, 4]);
      context.lineWidth = 1;
      context.lineCap = "round";
      context.strokeStyle = "rgba(87,228,160,.56)";
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    };

    map.on("render", draw);
    draw();
    return () => {
      map.off("render", draw);
      const context = canvas.getContext("2d");
      if (context) context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [mapSession]);

  return <canvas ref={vectorCanvasRef} className="single-direction-vector-overlay" aria-hidden="true"/>;
}

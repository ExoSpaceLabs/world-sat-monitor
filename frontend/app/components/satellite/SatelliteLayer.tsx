"use client";

import {useEffect, useRef} from "react";
import type {GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker} from "maplibre-gl";
import type {MapSession} from "../../domain/types";
import {estimateRenderedGlobeRadius} from "../globe/projection";
import {
  EARTH_RADIUS_KM,
  headingEndpoint,
  isSatelliteOccluded,
  type GlobeVector,
  type Satellite,
  type SatelliteTrackPoint,
} from "../../domain/satellite";

export const SATELLITE_HEADING_LAYER_ID = "selected-satellite-heading";
export const SATELLITE_HISTORY_LAYER_ID = "selected-satellite-history";
export const SATELLITE_PREDICTION_LAYER_ID = "selected-satellite-prediction";
const SATELLITE_HEADING_SOURCE_ID = "selected-satellite-heading-source";
const SATELLITE_HISTORY_SOURCE_ID = "selected-satellite-history-source";
const SATELLITE_PREDICTION_SOURCE_ID = "selected-satellite-prediction-source";
const ORBIT_LAYER_IDS = [
  SATELLITE_HISTORY_LAYER_ID,
  SATELLITE_PREDICTION_LAYER_ID,
  SATELLITE_HEADING_LAYER_ID,
] as const;

type MarkerElements = {
  heading: HTMLElement;
  name: HTMLElement;
  node: HTMLButtonElement;
  visual: HTMLElement;
};

type OrbitGeoJson = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, never>;
    geometry: {
      type: "MultiLineString";
      coordinates: number[][][];
    };
  }>;
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

function headingFeature(satellite: Satellite) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [satellite.lon, satellite.lat],
        headingEndpoint(satellite.lon, satellite.lat, satellite.heading, 1750),
      ],
    },
  };
}

function splitAtDateline(points: SatelliteTrackPoint[]) {
  const lines: number[][][] = [];
  let current: number[][] = [];
  let previousLongitude: number | null = null;

  for (const point of points) {
    if (previousLongitude !== null && Math.abs(point.lon - previousLongitude) > 180) {
      if (current.length >= 2) lines.push(current);
      current = [];
    }
    current.push([point.lon, point.lat]);
    previousLongitude = point.lon;
  }

  if (current.length >= 2) lines.push(current);
  return lines;
}

function pathData(
  track: SatelliteTrackPoint[],
  segment: SatelliteTrackPoint["segment"],
  satellite: Satellite,
): OrbitGeoJson {
  const points = track.filter((point) => point.segment === segment);
  const currentPoint: SatelliteTrackPoint = {
    time: "",
    lat: satellite.lat,
    lon: satellite.lon,
    altitude: satellite.altitude,
    segment,
  };
  const connected = segment === "history"
    ? [...points, currentPoint]
    : [currentPoint, ...points];
  const coordinates = splitAtDateline(connected);

  // A FeatureCollection with zero features is valid GeoJSON. An empty
  // MultiLineString is not accepted consistently by MapLibre. The satellite
  // layer is commonly installed before the first track request completes, so
  // using valid empty data keeps the sources/layers alive until data arrives.
  if (coordinates.length === 0) {
    return {type: "FeatureCollection", features: []};
  }

  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: {type: "MultiLineString", coordinates},
    }],
  };
}

function ensureOrbitSources(
  map: MapLibreMap,
  track: SatelliteTrackPoint[],
  satellite: Satellite,
) {
  if (!map.getSource(SATELLITE_HISTORY_SOURCE_ID)) {
    map.addSource(SATELLITE_HISTORY_SOURCE_ID, {
      type: "geojson",
      data: pathData(track, "history", satellite),
    });
  }
  if (!map.getSource(SATELLITE_PREDICTION_SOURCE_ID)) {
    map.addSource(SATELLITE_PREDICTION_SOURCE_ID, {
      type: "geojson",
      data: pathData(track, "prediction", satellite),
    });
  }
  if (!map.getSource(SATELLITE_HEADING_SOURCE_ID)) {
    map.addSource(SATELLITE_HEADING_SOURCE_ID, {
      type: "geojson",
      data: headingFeature(satellite),
    });
  }
}

function ensureOrbitLayers(map: MapLibreMap) {
  if (!map.getLayer(SATELLITE_HISTORY_LAYER_ID)) {
    map.addLayer({
      id: SATELLITE_HISTORY_LAYER_ID,
      type: "line",
      source: SATELLITE_HISTORY_SOURCE_ID,
      layout: {"line-cap": "round", "line-join": "round"},
      paint: {
        "line-color": "#57e4a0",
        "line-width": 3,
        "line-opacity": 0.92,
      },
    });
  }

  if (!map.getLayer(SATELLITE_PREDICTION_LAYER_ID)) {
    map.addLayer({
      id: SATELLITE_PREDICTION_LAYER_ID,
      type: "line",
      source: SATELLITE_PREDICTION_SOURCE_ID,
      layout: {"line-cap": "round", "line-join": "round"},
      paint: {
        "line-color": "#58cddd",
        "line-width": 3,
        "line-dasharray": [2, 2],
        "line-opacity": 0.94,
      },
    });
  }

  if (!map.getLayer(SATELLITE_HEADING_LAYER_ID)) {
    map.addLayer({
      id: SATELLITE_HEADING_LAYER_ID,
      type: "line",
      source: SATELLITE_HEADING_SOURCE_ID,
      layout: {"line-cap": "round", "line-join": "round"},
      paint: {
        "line-color": "#8affc6",
        "line-width": 2.5,
        "line-dasharray": [1, 2],
        "line-opacity": 1,
      },
    });
  }
}

function promoteOrbitLayers(map: MapLibreMap) {
  const layers = map.getStyle().layers ?? [];
  const ids = layers.map((layer) => layer.id);
  const currentTop = ids.slice(-ORBIT_LAYER_IDS.length);
  const alreadyTop = ORBIT_LAYER_IDS.every((id, index) => currentTop[index] === id);
  if (alreadyTop) return;

  for (const id of ORBIT_LAYER_IDS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

function installOrbitLayers(
  map: MapLibreMap,
  track: SatelliteTrackPoint[],
  satellite: Satellite,
) {
  ensureOrbitSources(map, track, satellite);
  ensureOrbitLayers(map);
  promoteOrbitLayers(map);
}

function removeOrbitLayers(map: MapLibreMap) {
  for (const id of [...ORBIT_LAYER_IDS].reverse()) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SATELLITE_HEADING_SOURCE_ID)) map.removeSource(SATELLITE_HEADING_SOURCE_ID);
  if (map.getSource(SATELLITE_PREDICTION_SOURCE_ID)) map.removeSource(SATELLITE_PREDICTION_SOURCE_ID);
  if (map.getSource(SATELLITE_HISTORY_SOURCE_ID)) map.removeSource(SATELLITE_HISTORY_SOURCE_ID);
}

function getGlobeCameraPosition(map: MapLibreMap): GlobeVector | null {
  const transform = map._camera.transform;
  if (!transform.getClippingPlane()) return null;
  const camera = transform.cameraPosition;
  return [camera[0], camera[1], camera[2]];
}

function updateMarkerPresentation(
  map: MapLibreMap,
  elements: MarkerElements,
  satellite: Satellite,
) {
  const earthCenter = map.project(map.getCenter());
  const surfacePoint = map.project([satellite.lon, satellite.lat]);
  const radialX = surfacePoint.x - earthCenter.x;
  const radialY = surfacePoint.y - earthCenter.y;
  const radialDistance = Math.hypot(radialX, radialY);
  const globeRadius = estimateRenderedGlobeRadius(map);
  const altitudeRatio = Math.max(0, satellite.altitude) / EARTH_RADIUS_KM;
  const surfaceRadius = Math.min(radialDistance, globeRadius);
  const altitudePixels = surfaceRadius * altitudeRatio;
  const inverseDistance = radialDistance > 1e-6 ? 1 / radialDistance : 0;
  elements.visual.style.transform = `translate3d(${(radialX * inverseDistance * altitudePixels).toFixed(2)}px,${(radialY * inverseDistance * altitudePixels).toFixed(2)}px,0)`;

  const cameraPosition = getGlobeCameraPosition(map);
  const occluded = cameraPosition
    ? isSatelliteOccluded(satellite, cameraPosition)
    : false;
  elements.node.classList.toggle("occluded", occluded);
  elements.node.dataset.visibility = occluded ? "occluded" : "visible";
}

type SatelliteLayerProps = {
  mapSession: MapSession | null;
  satellite: Satellite;
  track: SatelliteTrackPoint[];
  selected: boolean;
  onSelect: () => void;
};

export function SatelliteLayer({
  mapSession,
  satellite,
  track,
  selected,
  onSelect,
}: SatelliteLayerProps) {
  const map = mapSession?.map;
  const Marker = mapSession?.maplibre.Marker;
  const elementsRef = useRef<MarkerElements | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const latestSatelliteRef = useRef(satellite);
  const latestTrackRef = useRef(track);

  useEffect(() => {
    latestSatelliteRef.current = satellite;
  }, [satellite]);
  useEffect(() => {
    latestTrackRef.current = track;
  }, [track]);

  useEffect(() => {
    if (!map || !Marker) return;
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

    const update = () => updateMarkerPresentation(map, elements, latestSatelliteRef.current);
    map.on("render", update);
    update();
    return () => {
      map.off("render", update);
      marker.remove();
      if (elementsRef.current === elements) elementsRef.current = null;
      if (markerRef.current === marker) markerRef.current = null;
    };
  }, [Marker, map, onSelect]);

  useEffect(() => {
    const elements = elementsRef.current;
    const marker = markerRef.current;
    if (!map || !elements || !marker) return;
    elements.name.textContent = satellite.name;
    elements.heading.textContent = `${satellite.heading.toFixed(1)}° HEADING · ${satellite.altitude.toFixed(1)} KM`;
    elements.node.classList.toggle("selected", selected);
    elements.node.setAttribute("aria-label", `Select and follow ${satellite.name}`);
    marker.setLngLat([satellite.lon, satellite.lat]);
    updateMarkerPresentation(map, elements, satellite);
  }, [map, satellite, selected]);

  useEffect(() => {
    if (!map) return;
    let disposed = false;

    const install = () => {
      if (disposed || !map.isStyleLoaded()) return;
      try {
        installOrbitLayers(map, latestTrackRef.current, latestSatelliteRef.current);
      } catch (error) {
        console.error("Unable to install satellite orbit layers", error);
      }
    };

    // style.load is normally enough. idle is the recovery path for the case
    // where React receives the map session while MapLibre is still completing
    // a style/projection transition.
    install();
    map.on("style.load", install);
    map.on("idle", install);

    return () => {
      disposed = true;
      map.off("style.load", install);
      map.off("idle", install);
      if (map.isStyleLoaded()) removeOrbitLayers(map);
    };
  }, [map, mapSession?.styleRevision]);

  useEffect(() => {
    const heading = map?.getSource(SATELLITE_HEADING_SOURCE_ID) as GeoJSONSource | undefined;
    const history = map?.getSource(SATELLITE_HISTORY_SOURCE_ID) as GeoJSONSource | undefined;
    const prediction = map?.getSource(SATELLITE_PREDICTION_SOURCE_ID) as GeoJSONSource | undefined;
    heading?.setData(headingFeature(satellite));
    history?.setData(pathData(latestTrackRef.current, "history", satellite));
    prediction?.setData(pathData(latestTrackRef.current, "prediction", satellite));
  }, [map, satellite]);

  useEffect(() => {
    const history = map?.getSource(SATELLITE_HISTORY_SOURCE_ID) as GeoJSONSource | undefined;
    const prediction = map?.getSource(SATELLITE_PREDICTION_SOURCE_ID) as GeoJSONSource | undefined;
    history?.setData(pathData(track, "history", latestSatelliteRef.current));
    prediction?.setData(pathData(track, "prediction", latestSatelliteRef.current));
  }, [map, track]);

  return null;
}

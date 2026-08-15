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

type MarkerElements = {heading: HTMLElement; name: HTMLElement; node: HTMLButtonElement; visual: HTMLElement};

function createMarkerNode(onSelect: () => void): MarkerElements {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "satellite-marker";
  const visual = document.createElement("span");
  visual.className = "satellite-visual";
  const pulse = document.createElement("span"); pulse.className = "satellite-pulse";
  const core = document.createElement("span"); core.className = "satellite-core";
  const label = document.createElement("span"); label.className = "satellite-label";
  const name = document.createElement("b");
  const heading = document.createElement("small");
  label.append(name, heading); visual.append(pulse, core, label); node.append(visual);
  node.addEventListener("click", onSelect);
  return {heading, name, node, visual};
}

function removeHeading(map: MapLibreMap) {
  if (map.getLayer(SATELLITE_HEADING_LAYER_ID)) map.removeLayer(SATELLITE_HEADING_LAYER_ID);
  if (map.getSource(SATELLITE_HEADING_SOURCE_ID)) map.removeSource(SATELLITE_HEADING_SOURCE_ID);
}

function headingFeature(satellite: Satellite) {
  return {type: "Feature" as const, properties: {}, geometry: {type: "LineString" as const, coordinates: [[satellite.lon, satellite.lat], headingEndpoint(satellite.lon, satellite.lat, satellite.heading, 1750)]}};
}

function addHeading(map: MapLibreMap, satellite: Satellite) {
  removeHeading(map);
  map.addSource(SATELLITE_HEADING_SOURCE_ID, {type: "geojson", data: headingFeature(satellite)});
  map.addLayer({id: SATELLITE_HEADING_LAYER_ID, type: "line", source: SATELLITE_HEADING_SOURCE_ID, paint: {"line-color": "#66f0ad", "line-width": 2, "line-dasharray": [3, 3], "line-opacity": 0.95}});
}

function removePath(map: MapLibreMap) {
  if (map.getLayer(SATELLITE_PREDICTION_LAYER_ID)) map.removeLayer(SATELLITE_PREDICTION_LAYER_ID);
  if (map.getLayer(SATELLITE_HISTORY_LAYER_ID)) map.removeLayer(SATELLITE_HISTORY_LAYER_ID);
  if (map.getSource(SATELLITE_PREDICTION_SOURCE_ID)) map.removeSource(SATELLITE_PREDICTION_SOURCE_ID);
  if (map.getSource(SATELLITE_HISTORY_SOURCE_ID)) map.removeSource(SATELLITE_HISTORY_SOURCE_ID);
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

function pathFeature(track: SatelliteTrackPoint[], segment: SatelliteTrackPoint["segment"], satellite: Satellite) {
  const points = track.filter((point) => point.segment === segment);
  const currentPoint: SatelliteTrackPoint = {time: "", lat: satellite.lat, lon: satellite.lon, altitude: satellite.altitude, segment};
  const connected = segment === "history" ? [...points, currentPoint] : [currentPoint, ...points];
  return {type: "Feature" as const, properties: {}, geometry: {type: "MultiLineString" as const, coordinates: splitAtDateline(connected)}};
}

function addPath(map: MapLibreMap, track: SatelliteTrackPoint[], satellite: Satellite) {
  removePath(map);
  map.addSource(SATELLITE_HISTORY_SOURCE_ID, {type: "geojson", data: pathFeature(track, "history", satellite)});
  map.addSource(SATELLITE_PREDICTION_SOURCE_ID, {type: "geojson", data: pathFeature(track, "prediction", satellite)});
  map.addLayer({id: SATELLITE_HISTORY_LAYER_ID, type: "line", source: SATELLITE_HISTORY_SOURCE_ID, paint: {"line-color": "#57e4a0", "line-width": 2, "line-opacity": 0.72}});
  map.addLayer({id: SATELLITE_PREDICTION_LAYER_ID, type: "line", source: SATELLITE_PREDICTION_SOURCE_ID, paint: {"line-color": "#58cddd", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.78}});
}

function getGlobeCameraPosition(map: MapLibreMap): GlobeVector | null {
  const transform = map._camera.transform;
  if (!transform.getClippingPlane()) return null;
  const camera = transform.cameraPosition;
  return [camera[0], camera[1], camera[2]];
}

function updateMarkerPresentation(map: MapLibreMap, elements: MarkerElements, satellite: Satellite) {
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
  const occluded = cameraPosition ? isSatelliteOccluded(satellite, cameraPosition) : false;
  elements.node.classList.toggle("occluded", occluded);
  elements.node.dataset.visibility = occluded ? "occluded" : "visible";
}

type SatelliteLayerProps = {mapSession: MapSession | null; satellite: Satellite; track: SatelliteTrackPoint[]; selected: boolean; onSelect: () => void};

export function SatelliteLayer({mapSession, satellite, track, selected, onSelect}: SatelliteLayerProps) {
  const map = mapSession?.map;
  const Marker = mapSession?.maplibre.Marker;
  const elementsRef = useRef<MarkerElements | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const latestSatelliteRef = useRef(satellite);
  const latestTrackRef = useRef(track);
  useEffect(() => { latestSatelliteRef.current = satellite; }, [satellite]);
  useEffect(() => { latestTrackRef.current = track; }, [track]);

  useEffect(() => {
    if (!map || !Marker) return;
    const elements = createMarkerNode(onSelect);
    const marker = new Marker({element: elements.node, anchor: "center", opacity: 1, opacityWhenCovered: 1, subpixelPositioning: true})
      .setLngLat([latestSatelliteRef.current.lon, latestSatelliteRef.current.lat]).addTo(map);
    elementsRef.current = elements; markerRef.current = marker;
    const update = () => updateMarkerPresentation(map, elements, latestSatelliteRef.current);
    map.on("render", update); update();
    return () => { map.off("render", update); marker.remove(); if (elementsRef.current === elements) elementsRef.current = null; if (markerRef.current === marker) markerRef.current = null; };
  }, [Marker, map, onSelect]);

  useEffect(() => {
    const elements = elementsRef.current; const marker = markerRef.current;
    if (!map || !elements || !marker) return;
    elements.name.textContent = satellite.name;
    elements.heading.textContent = `${satellite.heading.toFixed(1)}° HEADING · ${satellite.altitude.toFixed(1)} KM`;
    elements.node.classList.toggle("selected", selected);
    elements.node.setAttribute("aria-label", `Select and follow ${satellite.name}`);
    marker.setLngLat([satellite.lon, satellite.lat]);
    updateMarkerPresentation(map, elements, satellite);
  }, [map, satellite, selected]);

  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    addPath(map, latestTrackRef.current, latestSatelliteRef.current);
    addHeading(map, latestSatelliteRef.current);
    return () => { if (!map.isStyleLoaded()) return; removeHeading(map); removePath(map); };
  }, [map, mapSession?.styleRevision]);

  useEffect(() => {
    const source = map?.getSource(SATELLITE_HEADING_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(headingFeature(satellite));
    const history = map?.getSource(SATELLITE_HISTORY_SOURCE_ID) as GeoJSONSource | undefined;
    const prediction = map?.getSource(SATELLITE_PREDICTION_SOURCE_ID) as GeoJSONSource | undefined;
    history?.setData(pathFeature(latestTrackRef.current, "history", satellite));
    prediction?.setData(pathFeature(latestTrackRef.current, "prediction", satellite));
  }, [map, satellite]);

  useEffect(() => {
    const history = map?.getSource(SATELLITE_HISTORY_SOURCE_ID) as GeoJSONSource | undefined;
    const prediction = map?.getSource(SATELLITE_PREDICTION_SOURCE_ID) as GeoJSONSource | undefined;
    history?.setData(pathFeature(track, "history", latestSatelliteRef.current));
    prediction?.setData(pathFeature(track, "prediction", latestSatelliteRef.current));
  }, [map, track]);

  return null;
}

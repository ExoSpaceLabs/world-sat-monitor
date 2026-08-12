"use client";

import {useEffect, useRef} from "react";
import type {GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker} from "maplibre-gl";
import type {SceneOrientation} from "../../domain/scene";
import type {MapSession} from "../../domain/types";
import {
  EARTH_RADIUS_KM,
  headingEndpoint,
  isSatelliteOccluded,
  type Satellite,
} from "../../domain/satellite";

export const SATELLITE_HEADING_LAYER_ID = "selected-satellite-heading";
const SATELLITE_HEADING_SOURCE_ID = "selected-satellite-heading-source";
const DEG = Math.PI / 180;

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

function removeHeading(map: MapLibreMap) {
  if (map.getLayer(SATELLITE_HEADING_LAYER_ID)) map.removeLayer(SATELLITE_HEADING_LAYER_ID);
  if (map.getSource(SATELLITE_HEADING_SOURCE_ID)) map.removeSource(SATELLITE_HEADING_SOURCE_ID);
}

function addHeading(map: MapLibreMap, satellite: Satellite) {
  removeHeading(map);
  map.addSource(SATELLITE_HEADING_SOURCE_ID, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [satellite.lon, satellite.lat],
          headingEndpoint(satellite.lon, satellite.lat, satellite.heading, 1750),
        ],
      },
    },
  });
  map.addLayer({
    id: SATELLITE_HEADING_LAYER_ID,
    type: "line",
    source: SATELLITE_HEADING_SOURCE_ID,
    paint: {
      "line-color": "#66f0ad",
      "line-width": 2,
      "line-dasharray": [3, 3],
      "line-opacity": 0.95,
    },
  });
}

function destination(longitude: number, latitude: number, bearingDegrees: number, distanceDegrees: number) {
  const latitude1 = latitude * DEG;
  const longitude1 = longitude * DEG;
  const bearing = bearingDegrees * DEG;
  const distance = distanceDegrees * DEG;
  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(distance)
      + Math.cos(latitude1) * Math.sin(distance) * Math.cos(bearing),
  );
  const longitude2 = longitude1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude1),
    Math.cos(distance) - Math.sin(latitude1) * Math.sin(latitude2),
  );
  return [longitude2 / DEG, latitude2 / DEG] as [number, number];
}

function estimatedGlobeRadius(map: MapLibreMap) {
  const center = map.getCenter();
  const centerPoint = map.project(center);
  const canvas = map.getCanvas();
  const maximum = Math.min(canvas.clientWidth, canvas.clientHeight) / 2;
  const samples = [0, 90, 180, 270]
    .map((bearing) => map.project(destination(center.lng, center.lat, bearing, 85)))
    .map((point) => Math.hypot(point.x - centerPoint.x, point.y - centerPoint.y) / Math.sin(85 * DEG))
    .filter((radius) => Number.isFinite(radius) && radius > 0 && radius < maximum * 2)
    .sort((left, right) => left - right);
  if (samples.length === 0) return maximum;
  return Math.min(maximum, samples[Math.floor(samples.length / 2)]);
}

function updateMarkerPresentation(
  map: MapLibreMap,
  elements: MarkerElements,
  orientation: SceneOrientation,
  satellite: Satellite,
) {
  const earthCenter = map.project(map.getCenter());
  const surfacePoint = map.project([satellite.lon, satellite.lat]);
  const radialX = surfacePoint.x - earthCenter.x;
  const radialY = surfacePoint.y - earthCenter.y;
  const radialDistance = Math.hypot(radialX, radialY);
  const globeRadius = estimatedGlobeRadius(map);
  const altitudeRatio = Math.max(0, satellite.altitude) / EARTH_RADIUS_KM;
  const surfaceRadius = Math.min(radialDistance, globeRadius);
  const altitudePixels = surfaceRadius * altitudeRatio;
  const inverseDistance = radialDistance > 1e-6 ? 1 / radialDistance : 0;
  const offsetX = radialX * inverseDistance * altitudePixels;
  const offsetY = radialY * inverseDistance * altitudePixels;
  elements.visual.style.transform = `translate3d(${offsetX.toFixed(2)}px,${offsetY.toFixed(2)}px,0)`;
  elements.node.dataset.altitudeOffset = altitudePixels.toFixed(2);

  const occluded = isSatelliteOccluded(satellite, orientation);
  elements.node.classList.toggle("occluded", occluded);
  elements.node.dataset.visibility = occluded ? "occluded" : "visible";
}

type SatelliteLayerProps = {
  mapSession: MapSession | null;
  orientation: SceneOrientation;
  satellite: Satellite;
  selected: boolean;
  onSelect: () => void;
};

export function SatelliteLayer({
  mapSession,
  orientation,
  satellite,
  selected,
  onSelect,
}: SatelliteLayerProps) {
  const map = mapSession?.map;
  const Marker = mapSession?.maplibre.Marker;
  const elementsRef = useRef<MarkerElements | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const latestRef = useRef({orientation, satellite});

  useEffect(() => {
    latestRef.current = {orientation, satellite};
  }, [orientation, satellite]);

  useEffect(() => {
    if (!map || !Marker) return;
    const elements = createMarkerNode(onSelect);
    const marker = new Marker({
      element: elements.node,
      anchor: "center",
      opacity: 1,
      opacityWhenCovered: 1,
    })
      .setLngLat([latestRef.current.satellite.lon, latestRef.current.satellite.lat])
      .addTo(map);
    elementsRef.current = elements;
    markerRef.current = marker;

    const update = () => updateMarkerPresentation(
      map,
      elements,
      latestRef.current.orientation,
      latestRef.current.satellite,
    );
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
    elements.heading.textContent = `${satellite.heading}° HEADING · ${satellite.altitude} KM`;
    elements.node.classList.toggle("selected", selected);
    elements.node.setAttribute("aria-label", `Select and follow ${satellite.name}`);
    marker.setLngLat([satellite.lon, satellite.lat]);
    updateMarkerPresentation(map, elements, orientation, satellite);
  }, [map, orientation, satellite, selected]);

  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    addHeading(map, satellite);
    return () => {
      if (map.isStyleLoaded()) removeHeading(map);
    };
  }, [map, mapSession?.styleRevision, satellite]);

  useEffect(() => {
    const source = map?.getSource(SATELLITE_HEADING_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [satellite.lon, satellite.lat],
          headingEndpoint(satellite.lon, satellite.lat, satellite.heading, 1750),
        ],
      },
    });
  }, [map, satellite]);

  return null;
}

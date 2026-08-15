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
} from "../../domain/satellite";

export const SATELLITE_HEADING_LAYER_ID = "selected-satellite-heading";
const SATELLITE_HEADING_SOURCE_ID = "selected-satellite-heading-source";

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

function getGlobeCameraPosition(map: MapLibreMap): GlobeVector | null {
  // MapLibre's globe transform exposes the camera in the same unit-sphere
  // coordinate space used by its horizon clipping. When globe rendering has
  // transitioned fully to Mercator there is no spherical horizon to occlude
  // against, so leave the marker visible.
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
  const offsetX = radialX * inverseDistance * altitudePixels;
  const offsetY = radialY * inverseDistance * altitudePixels;
  elements.visual.style.transform = `translate3d(${offsetX.toFixed(2)}px,${offsetY.toFixed(2)}px,0)`;
  elements.node.dataset.altitudeOffset = altitudePixels.toFixed(2);

  const cameraPosition = getGlobeCameraPosition(map);
  const occluded = cameraPosition
    ? isSatelliteOccluded(satellite, cameraPosition)
    : false;
  elements.node.classList.toggle("occluded", occluded);
  elements.node.dataset.visibility = occluded ? "occluded" : "visible";
  elements.node.dataset.cameraRadius = cameraPosition
    ? Math.hypot(...cameraPosition).toFixed(4)
    : "flat";
}

type SatelliteLayerProps = {
  mapSession: MapSession | null;
  satellite: Satellite;
  selected: boolean;
  onSelect: () => void;
};

export function SatelliteLayer({
  mapSession,
  satellite,
  selected,
  onSelect,
}: SatelliteLayerProps) {
  const map = mapSession?.map;
  const Marker = mapSession?.maplibre.Marker;
  const elementsRef = useRef<MarkerElements | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const latestSatelliteRef = useRef(satellite);

  useEffect(() => {
    latestSatelliteRef.current = satellite;
  }, [satellite]);

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

    const update = () => updateMarkerPresentation(
      map,
      elements,
      latestSatelliteRef.current,
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
    updateMarkerPresentation(map, elements, satellite);
  }, [map, satellite, selected]);

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

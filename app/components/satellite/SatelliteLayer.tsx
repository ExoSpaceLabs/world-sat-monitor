"use client";

import {useEffect} from "react";
import type {GeoJSONSource, Map as MapLibreMap} from "maplibre-gl";
import type {MapSession} from "../../domain/types";
import {headingEndpoint, type Satellite} from "../../domain/satellite";

export const SATELLITE_HEADING_LAYER_ID = "selected-satellite-heading";
const SATELLITE_HEADING_SOURCE_ID = "selected-satellite-heading-source";

function createMarkerNode(satellite: Satellite, selected: boolean, onSelect: () => void) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `satellite-marker${selected ? " selected" : ""}`;
  node.setAttribute("aria-label", `Select and follow ${satellite.name}`);

  const pulse = document.createElement("span");
  pulse.className = "satellite-pulse";
  const core = document.createElement("span");
  core.className = "satellite-core";
  const label = document.createElement("span");
  label.className = "satellite-label";
  const name = document.createElement("b");
  name.textContent = satellite.name;
  const heading = document.createElement("small");
  heading.textContent = `${satellite.heading}° HEADING`;
  label.append(name, heading);
  node.append(pulse, core, label);
  node.addEventListener("click", onSelect);
  return node;
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

type SatelliteLayerProps = {
  mapSession: MapSession | null;
  satellite: Satellite;
  selected: boolean;
  onSelect: () => void;
};

export function SatelliteLayer({mapSession, satellite, selected, onSelect}: SatelliteLayerProps) {
  const map = mapSession?.map;
  const Marker = mapSession?.maplibre.Marker;

  useEffect(() => {
    if (!map || !Marker) return;
    const node = createMarkerNode(satellite, selected, onSelect);
    const marker = new Marker({element: node, anchor: "center"})
      .setLngLat([satellite.lon, satellite.lat])
      .addTo(map);
    return () => marker.remove();
  }, [Marker, map, onSelect, satellite, selected]);

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

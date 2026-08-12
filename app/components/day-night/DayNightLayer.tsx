"use client";

import {useEffect, useRef} from "react";
import type {GeoJSONSource, Map as MapLibreMap} from "maplibre-gl";
import type {SolarState} from "../../domain/solar";
import type {MapSession} from "../../domain/types";

export const NIGHT_SOURCE_ID = "worldsat-night-hemisphere-source";
export const NIGHT_LAYER_ID = "worldsat-night-hemisphere";
const GRID_DEGREES = 3;
const TERMINATOR_BLEND = 0.075;
const ALPHA_LEVELS = [0.18, 0.34, 0.52, 0.7, 0.86, 1] as const;
const DEG = Math.PI / 180;

type Coordinate = [number, number];
type PolygonCoordinates = Coordinate[][];

type NightGeometry = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {alpha: number};
    geometry: {
      type: "MultiPolygon";
      coordinates: PolygonCoordinates[];
    };
  }>;
};

function illumination(latitude: number, longitude: number, sun: SolarState) {
  const lat = latitude * DEG;
  const sunLat = sun.latitude * DEG;
  const deltaLon = (longitude - sun.longitude) * DEG;
  return Math.sin(lat) * Math.sin(sunLat)
    + Math.cos(lat) * Math.cos(sunLat) * Math.cos(deltaLon);
}

function alphaLevel(illuminationValue: number) {
  if (illuminationValue >= 0) return -1;
  const blend = Math.min(1, -illuminationValue / TERMINATOR_BLEND);
  return Math.min(ALPHA_LEVELS.length - 1, Math.floor(blend * ALPHA_LEVELS.length));
}

/**
 * Builds the night side from small geographic cells rather than one giant
 * hemisphere polygon. Every cell remains local in longitude/latitude, so
 * MapLibre can tessellate, curve and horizon-clip it reliably on globe view.
 */
function nightHemisphereGeometry(sun: SolarState): NightGeometry {
  const groups: PolygonCoordinates[][] = ALPHA_LEVELS.map(() => []);

  for (let south = -90; south < 90; south += GRID_DEGREES) {
    const north = Math.min(90, south + GRID_DEGREES);
    const sampleLatitude = (south + north) / 2;
    for (let west = -180; west < 180; west += GRID_DEGREES) {
      const east = Math.min(180, west + GRID_DEGREES);
      const sampleLongitude = (west + east) / 2;
      const level = alphaLevel(illumination(sampleLatitude, sampleLongitude, sun));
      if (level < 0) continue;
      groups[level].push([[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]]);
    }
  }

  return {
    type: "FeatureCollection",
    features: groups.flatMap((coordinates, index) => coordinates.length === 0 ? [] : [{
      type: "Feature" as const,
      properties: {alpha: ALPHA_LEVELS[index]},
      geometry: {
        type: "MultiPolygon" as const,
        coordinates,
      },
    }]),
  };
}

function opacityExpression(opacity: number) {
  return [
    "*",
    Math.max(0, Math.min(1, opacity)),
    ["coalesce", ["get", "alpha"], 1],
  ];
}

function removeNightLayer(map: MapLibreMap) {
  if (map.getLayer(NIGHT_LAYER_ID)) map.removeLayer(NIGHT_LAYER_ID);
  if (map.getSource(NIGHT_SOURCE_ID)) map.removeSource(NIGHT_SOURCE_ID);
}

function addNightLayer(map: MapLibreMap, sun: SolarState, opacity: number) {
  removeNightLayer(map);
  map.addSource(NIGHT_SOURCE_ID, {
    type: "geojson",
    data: nightHemisphereGeometry(sun),
  });
  map.addLayer({
    id: NIGHT_LAYER_ID,
    type: "fill",
    source: NIGHT_SOURCE_ID,
    paint: {
      "fill-antialias": false,
      "fill-color": "#00030a",
      "fill-opacity": opacityExpression(opacity) as never,
    },
  });
  map.triggerRepaint();
}

type DayNightLayerProps = {
  enabled: boolean;
  mapSession: MapSession | null;
  opacity: number;
  solarState: SolarState;
};

export function DayNightLayer({
  enabled,
  mapSession,
  opacity,
  solarState,
}: DayNightLayerProps) {
  const map = mapSession?.map;
  const latestRef = useRef({opacity, solarState});

  useEffect(() => {
    latestRef.current = {opacity, solarState};
  }, [opacity, solarState]);

  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    addNightLayer(map, latestRef.current.solarState, latestRef.current.opacity);
    return () => {
      if (map.isStyleLoaded()) removeNightLayer(map);
    };
  }, [map, mapSession?.styleRevision]);

  useEffect(() => {
    const source = map?.getSource(NIGHT_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(nightHemisphereGeometry(solarState));
    map?.triggerRepaint();
  }, [map, solarState]);

  useEffect(() => {
    if (!map?.getLayer(NIGHT_LAYER_ID)) return;
    map.setLayoutProperty(NIGHT_LAYER_ID, "visibility", enabled ? "visible" : "none");
    map.setPaintProperty(NIGHT_LAYER_ID, "fill-opacity", opacityExpression(opacity));
    map.triggerRepaint();
  }, [enabled, map, opacity]);

  return null;
}

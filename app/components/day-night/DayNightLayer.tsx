"use client";

import {useEffect} from "react";
import type {Map as MapLibreMap} from "maplibre-gl";
import type {MapSession} from "../../domain/types";
import type {SolarState} from "../../domain/solar";
import {createNightShadowCells} from "../../domain/solar";

export const NIGHT_LAYER_ID = "night-shadow-skin";
const NIGHT_SOURCE_ID = "night-shadow-skin-source";

function createShadowFeatureCollection(sun: SolarState) {
  return {
    type: "FeatureCollection" as const,
    features: createNightShadowCells(sun).map((cell) => ({
      type: "Feature" as const,
      properties: {opacity: cell.opacity},
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [cell.west, cell.south],
          [cell.east, cell.south],
          [cell.east, cell.north],
          [cell.west, cell.north],
          [cell.west, cell.south],
        ]],
      },
    })),
  };
}

function removeNightShadow(map: MapLibreMap) {
  if (map.getLayer(NIGHT_LAYER_ID)) map.removeLayer(NIGHT_LAYER_ID);
  if (map.getSource(NIGHT_SOURCE_ID)) map.removeSource(NIGHT_SOURCE_ID);
}

function addNightShadow(
  map: MapLibreMap,
  sun: SolarState,
  beforeLayerId?: string,
) {
  map.addSource(NIGHT_SOURCE_ID, {
    type: "geojson",
    data: createShadowFeatureCollection(sun),
  });
  map.addLayer({
    id: NIGHT_LAYER_ID,
    type: "fill",
    source: NIGHT_SOURCE_ID,
    paint: {
      "fill-color": "#00030a",
      "fill-opacity": ["get", "opacity"],
      "fill-antialias": false,
    },
  }, beforeLayerId);
}

type DayNightLayerProps = {
  enabled: boolean;
  mapSession: MapSession | null;
  solarState: SolarState;
  satelliteLayerId: string;
  utcMinute: string;
};

export function DayNightLayer({
  enabled,
  mapSession,
  solarState,
  satelliteLayerId,
  utcMinute,
}: DayNightLayerProps) {
  useEffect(() => {
    const map = mapSession?.map;
    if (!map || !map.isStyleLoaded()) return;
    removeNightShadow(map);
    if (!enabled) return;

    const beforeLayerId = map.getLayer(satelliteLayerId) ? satelliteLayerId : undefined;
    addNightShadow(map, solarState, beforeLayerId);

    return () => {
      if (map.isStyleLoaded()) removeNightShadow(map);
    };
  }, [enabled, mapSession, satelliteLayerId, solarState, utcMinute]);

  return null;
}

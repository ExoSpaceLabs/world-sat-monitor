"use client";

import {useEffect, useRef} from "react";
import type {GeoJSONSource, Map as MapLibreMap} from "maplibre-gl";
import type {SolarState} from "../../domain/solar";
import type {MapSession} from "../../domain/types";

const NIGHT_SOURCE_ID = "worldsat-night-hemisphere-source";
const NIGHT_LAYER_ID = "worldsat-night-hemisphere";
const TERMINATOR_SEGMENTS = 144;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

type Coordinate = [number, number];

type NightGeometry = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, never>;
    geometry: {
      type: "Polygon";
      coordinates: Coordinate[][];
    };
  }>;
};

function normalizeLongitude(longitude: number) {
  return (((longitude % 360) + 540) % 360) - 180;
}

function unwrapLongitude(longitude: number, reference: number) {
  let unwrapped = longitude;
  while (unwrapped - reference > 180) unwrapped -= 360;
  while (unwrapped - reference < -180) unwrapped += 360;
  return unwrapped;
}

/** Returns a point at a great-circle angular distance from the origin. */
function destination(
  longitude: number,
  latitude: number,
  bearingDegrees: number,
  angularDistanceDegrees: number,
): Coordinate {
  const latitude1 = latitude * DEG;
  const longitude1 = longitude * DEG;
  const bearing = bearingDegrees * DEG;
  const distance = angularDistanceDegrees * DEG;
  const sinLatitude1 = Math.sin(latitude1);
  const cosLatitude1 = Math.cos(latitude1);
  const sinDistance = Math.sin(distance);
  const cosDistance = Math.cos(distance);

  const latitude2 = Math.asin(
    sinLatitude1 * cosDistance
      + cosLatitude1 * sinDistance * Math.cos(bearing),
  );
  const longitude2 = longitude1 + Math.atan2(
    Math.sin(bearing) * sinDistance * cosLatitude1,
    cosDistance - sinLatitude1 * Math.sin(latitude2),
  );

  return [normalizeLongitude(longitude2 * RAD), latitude2 * RAD];
}

/**
 * Builds the night hemisphere as a fan of geodesic triangles centred on the
 * anti-solar point. MapLibre then projects and clips those triangles using the
 * exact same globe transform as the basemap, so there is no second synthetic
 * sphere to keep in registration.
 */
function nightHemisphereGeometry(sun: SolarState): NightGeometry {
  const antiSolarLongitude = normalizeLongitude(sun.longitude + 180);
  const antiSolarLatitude = -sun.latitude;
  const center: Coordinate = [antiSolarLongitude, antiSolarLatitude];
  const terminator: Coordinate[] = [];

  for (let index = 0; index <= TERMINATOR_SEGMENTS; index += 1) {
    terminator.push(destination(
      antiSolarLongitude,
      antiSolarLatitude,
      index * 360 / TERMINATOR_SEGMENTS,
      90,
    ));
  }

  const features: NightGeometry["features"] = [];
  for (let index = 0; index < TERMINATOR_SEGMENTS; index += 1) {
    const first = terminator[index];
    const second = terminator[index + 1];
    // Keep every triangle locally continuous across the antimeridian. MapLibre
    // accepts unwrapped longitudes and will still project them onto the globe.
    const firstUnwrapped: Coordinate = [
      unwrapLongitude(first[0], antiSolarLongitude),
      first[1],
    ];
    const secondUnwrapped: Coordinate = [
      unwrapLongitude(second[0], antiSolarLongitude),
      second[1],
    ];
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[center, firstUnwrapped, secondUnwrapped, center]],
      },
    });
  }

  return {type: "FeatureCollection", features};
}

function removeNightLayer(map: MapLibreMap) {
  if (map.getLayer(NIGHT_LAYER_ID)) map.removeLayer(NIGHT_LAYER_ID);
  if (map.getSource(NIGHT_SOURCE_ID)) map.removeSource(NIGHT_SOURCE_ID);
}

function addNightLayer(map: MapLibreMap, sun: SolarState) {
  removeNightLayer(map);
  map.addSource(NIGHT_SOURCE_ID, {
    type: "geojson",
    data: nightHemisphereGeometry(sun),
  });
  // No beforeId: keep the night treatment above the basemap labels. DOM based
  // satellite markers are still rendered above the MapLibre canvas.
  map.addLayer({
    id: NIGHT_LAYER_ID,
    type: "fill",
    source: NIGHT_SOURCE_ID,
    paint: {
      "fill-antialias": true,
      "fill-color": "#00030a",
      "fill-opacity": 0.7,
    },
  });
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
  const latestSolarRef = useRef(solarState);

  useEffect(() => {
    latestSolarRef.current = solarState;
  }, [solarState]);

  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    addNightLayer(map, latestSolarRef.current);
    return () => {
      if (map.isStyleLoaded()) removeNightLayer(map);
    };
  }, [map, mapSession?.styleRevision]);

  useEffect(() => {
    const source = map?.getSource(NIGHT_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(nightHemisphereGeometry(solarState));
  }, [map, solarState]);

  useEffect(() => {
    if (!map?.getLayer(NIGHT_LAYER_ID)) return;
    map.setLayoutProperty(NIGHT_LAYER_ID, "visibility", enabled ? "visible" : "none");
    map.setPaintProperty(NIGHT_LAYER_ID, "fill-opacity", Math.max(0, Math.min(1, opacity)));
  }, [enabled, map, opacity]);

  return null;
}

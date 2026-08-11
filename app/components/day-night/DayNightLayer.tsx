"use client";

import {useEffect} from "react";
import type {Map as MapLibreMap} from "maplibre-gl";
import type {MapSession} from "../../domain/types";
import type {SolarState} from "../../domain/solar";
import {nightShadowOpacity, solarElevation} from "../../domain/solar";

export const NIGHT_LAYER_IDS = ["night-shadow-west", "night-shadow-east"] as const;
const NIGHT_TEXTURE_WIDTH = 360;
const NIGHT_TEXTURE_HEIGHT = 180;

function paintNightTexture(canvas: HTMLCanvasElement, longitudeStart: number, sun: SolarState) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(NIGHT_TEXTURE_WIDTH, NIGHT_TEXTURE_HEIGHT);
  const longitudeSpan = 180;

  for (let y = 0; y < NIGHT_TEXTURE_HEIGHT; y += 1) {
    const latitude = 90 - (y + 0.5) * 180 / NIGHT_TEXTURE_HEIGHT;
    for (let x = 0; x < NIGHT_TEXTURE_WIDTH; x += 1) {
      const longitude = longitudeStart + (x + 0.5) * longitudeSpan / NIGHT_TEXTURE_WIDTH;
      const opacity = nightShadowOpacity(solarElevation(latitude, longitude, sun));
      const index = (y * NIGHT_TEXTURE_WIDTH + x) * 4;
      image.data[index] = 1;
      image.data[index + 1] = 5;
      image.data[index + 2] = 13;
      image.data[index + 3] = Math.round(opacity * 255);
    }
  }
  context.putImageData(image, 0, 0);
}

function removeNightSources(map: MapLibreMap) {
  for (const id of NIGHT_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
}

function addNightHemisphere(
  map: MapLibreMap,
  id: typeof NIGHT_LAYER_IDS[number],
  longitudeStart: number,
  sun: SolarState,
  beforeLayerId?: string,
) {
  const canvas = document.createElement("canvas");
  canvas.width = NIGHT_TEXTURE_WIDTH;
  canvas.height = NIGHT_TEXTURE_HEIGHT;
  paintNightTexture(canvas, longitudeStart, sun);
  const longitudeEnd = longitudeStart + 180;
  map.addSource(id, {
    type: "canvas",
    canvas,
    animate: false,
    coordinates: [
      [longitudeStart, 90],
      [longitudeEnd, 90],
      [longitudeEnd, -90],
      [longitudeStart, -90],
    ],
  });
  map.addLayer({
    id,
    type: "raster",
    source: id,
    paint: {"raster-opacity": 1, "raster-fade-duration": 0},
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
    removeNightSources(map);
    if (!enabled) return;

    const beforeLayerId = map.getLayer(satelliteLayerId) ? satelliteLayerId : undefined;
    addNightHemisphere(map, NIGHT_LAYER_IDS[0], -180, solarState, beforeLayerId);
    addNightHemisphere(map, NIGHT_LAYER_IDS[1], 0, solarState, beforeLayerId);

    return () => {
      if (map.isStyleLoaded()) removeNightSources(map);
    };
  }, [enabled, mapSession, satelliteLayerId, solarState, utcMinute]);

  return null;
}

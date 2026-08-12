"use client";

import {useEffect, useRef} from "react";
import type {SceneOrientation} from "../../domain/scene";
import {
  createCameraFrame,
  directionFromCoordinates,
  toCameraSpace,
} from "../../domain/scene";
import type {SolarState} from "../../domain/solar";
import {inertialSolarLongitude, shadowAlpha} from "../../domain/solar";
import type {MapSession} from "../../domain/types";

const MAX_RENDER_WIDTH = 960;
const SHADOW_GLOBE_SCALE = 1.018;
const MAPLIBRE_TILE_SIZE = 512;

type ShadowRuntime = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  mapSession: MapSession;
  renderQueued: boolean;
};

type ShadowState = {
  enabled: boolean;
  orientation: SceneOrientation;
  solarState: SolarState;
};

function earthRadiusPixels(orientation: SceneOrientation) {
  const worldSize = MAPLIBRE_TILE_SIZE * 2 ** orientation.zoom;
  const latitudeScale = Math.cos(orientation.latitude * Math.PI / 180);
  return worldSize / (2 * Math.PI * Math.max(0.08, latitudeScale));
}

function renderShadowGlobe(runtime: ShadowRuntime, state: ShadowState) {
  const {canvas, context, mapSession} = runtime;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.enabled || canvas.width === 0 || canvas.height === 0) return;

  const containerRect = mapSession.map.getCanvasContainer().getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0) return;
  const scale = canvas.width / containerRect.width;
  const mapCenter = mapSession.map.project(mapSession.map.getCenter());
  const centerX = mapCenter.x * scale;
  const centerY = mapCenter.y * scale;
  const radius = earthRadiusPixels(state.orientation) * SHADOW_GLOBE_SCALE * scale;
  if (radius <= 0) return;

  const sunDirection = directionFromCoordinates(
    inertialSolarLongitude(state.solarState, state.orientation.earthRotationDegrees),
    state.solarState.latitude,
  );
  const cameraSun = toCameraSpace(sunDirection, createCameraFrame(state.orientation));
  const left = Math.max(0, Math.floor(centerX - radius - 1));
  const right = Math.min(canvas.width, Math.ceil(centerX + radius + 1));
  const top = Math.max(0, Math.floor(centerY - radius - 1));
  const bottom = Math.min(canvas.height, Math.ceil(centerY + radius + 1));
  const image = context.createImageData(canvas.width, canvas.height);

  for (let py = top; py < bottom; py += 1) {
    const normalY = -(py + 0.5 - centerY) / radius;
    for (let px = left; px < right; px += 1) {
      const normalX = (px + 0.5 - centerX) / radius;
      const radialSquared = normalX * normalX + normalY * normalY;
      if (radialSquared > 1) continue;
      const normalZ = Math.sqrt(1 - radialSquared);
      const illumination = normalX * cameraSun.x
        + normalY * cameraSun.y
        + normalZ * cameraSun.outward;
      const alpha = shadowAlpha(illumination);
      if (alpha <= 0) continue;
      const index = (py * canvas.width + px) * 4;
      image.data[index] = 0;
      image.data[index + 1] = 3;
      image.data[index + 2] = 10;
      image.data[index + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
}

type DayNightLayerProps = {
  enabled: boolean;
  mapSession: MapSession | null;
  orientation: SceneOrientation;
  solarState: SolarState;
};

export function DayNightLayer({
  enabled,
  mapSession,
  orientation,
  solarState,
}: DayNightLayerProps) {
  const runtimeRef = useRef<ShadowRuntime | null>(null);
  const latestRef = useRef<ShadowState>({enabled, orientation, solarState});

  useEffect(() => {
    if (!mapSession) return;
    const container = mapSession.map.getCanvasContainer();
    const canvas = document.createElement("canvas");
    canvas.className = "day-night-globe";
    canvas.dataset.layer = "day-night-globe";
    canvas.setAttribute("aria-hidden", "true");
    const context = canvas.getContext("2d");
    if (!context) return;
    container.append(canvas);

    const runtime = {canvas, context, mapSession, renderQueued: false};
    runtimeRef.current = runtime;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const width = Math.min(MAX_RENDER_WIDTH, Math.max(320, Math.round(rect.width)));
      canvas.width = width;
      canvas.height = Math.max(180, Math.round(width * rect.height / rect.width));
      renderShadowGlobe(runtime, latestRef.current);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => {
      observer.disconnect();
      canvas.remove();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [mapSession]);

  useEffect(() => {
    latestRef.current = {enabled, orientation, solarState};
    const runtime = runtimeRef.current;
    if (!runtime || runtime.renderQueued) return;
    runtime.renderQueued = true;
    requestAnimationFrame(() => {
      const current = runtimeRef.current;
      if (!current) return;
      current.renderQueued = false;
      renderShadowGlobe(current, latestRef.current);
    });
  }, [enabled, orientation, solarState]);

  return null;
}

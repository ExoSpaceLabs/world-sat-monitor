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
import {estimateRenderedGlobeRadius} from "../globe/projection";

const MAX_RENDER_WIDTH = 960;
const SHADOW_GLOBE_SCALE = 1.004;

export type ShadowDebugState = {
  ready: boolean;
  radiusPx: number | null;
};

type ShadowRuntime = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  lastDebugRadius: number | null;
  lastDebugReady: boolean | null;
  renderQueued: boolean;
};

type ShadowState = {
  enabled: boolean;
  mapSession: MapSession | null;
  onDebugState?: (state: ShadowDebugState) => void;
  opacity: number;
  orientation: SceneOrientation;
  solarState: SolarState;
};

function reportDebug(
  runtime: ShadowRuntime,
  state: ShadowState,
  ready: boolean,
  radiusPx: number | null,
) {
  const roundedRadius = radiusPx === null ? null : Math.round(radiusPx);
  if (
    runtime.lastDebugReady === ready
    && runtime.lastDebugRadius === roundedRadius
  ) return;
  runtime.lastDebugReady = ready;
  runtime.lastDebugRadius = roundedRadius;
  state.onDebugState?.({ready, radiusPx: roundedRadius});
}

function renderShadowGlobe(runtime: ShadowRuntime, state: ShadowState) {
  const {canvas, context} = runtime;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const map = state.mapSession?.map;
  if (!map || canvas.width === 0 || canvas.height === 0) {
    reportDebug(runtime, state, false, null);
    return;
  }

  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    reportDebug(runtime, state, false, null);
    return;
  }

  const cssRadius = estimateRenderedGlobeRadius(map) * SHADOW_GLOBE_SCALE;
  if (!Number.isFinite(cssRadius) || cssRadius <= 0) {
    reportDebug(runtime, state, false, null);
    return;
  }
  reportDebug(runtime, state, true, cssRadius);
  if (!state.enabled) return;

  const scale = canvas.width / bounds.width;
  const center = map.project(map.getCenter());
  const centerX = center.x * scale;
  const centerY = center.y * scale;
  const radius = cssRadius * scale;

  const sunDirection = directionFromCoordinates(
    inertialSolarLongitude(state.solarState, state.orientation.earthRotationDegrees),
    state.solarState.latitude,
  );
  const cameraSun = toCameraSpace(sunDirection, createCameraFrame(state.orientation));
  const left = Math.max(0, Math.floor(centerX - radius - 1));
  const right = Math.min(canvas.width, Math.ceil(centerX + radius + 1));
  const top = Math.max(0, Math.floor(centerY - radius - 1));
  const bottom = Math.min(canvas.height, Math.ceil(centerY + radius + 1));
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width === 0 || height === 0) return;

  const image = context.createImageData(width, height);
  const opacity = Math.max(0, Math.min(1, state.opacity));

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
      const alpha = shadowAlpha(illumination, opacity);
      if (alpha <= 0) continue;
      const index = ((py - top) * width + (px - left)) * 4;
      image.data[index] = 0;
      image.data[index + 1] = 3;
      image.data[index + 2] = 10;
      image.data[index + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, left, top);
}

type DayNightLayerProps = {
  enabled: boolean;
  mapSession: MapSession | null;
  onDebugState?: (state: ShadowDebugState) => void;
  opacity: number;
  orientation: SceneOrientation;
  solarState: SolarState;
};

export function DayNightLayer({
  enabled,
  mapSession,
  onDebugState,
  opacity,
  orientation,
  solarState,
}: DayNightLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ShadowRuntime | null>(null);
  const latestRef = useRef<ShadowState>({
    enabled,
    mapSession,
    onDebugState,
    opacity,
    orientation,
    solarState,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", {alpha: true});
    if (!context) {
      onDebugState?.({ready: false, radiusPx: null});
      return;
    }
    const runtime: ShadowRuntime = {
      canvas,
      context,
      lastDebugRadius: null,
      lastDebugReady: null,
      renderQueued: false,
    };
    runtimeRef.current = runtime;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const width = Math.min(MAX_RENDER_WIDTH, Math.max(320, Math.round(rect.width)));
      canvas.width = width;
      canvas.height = Math.max(180, Math.round(width * rect.height / rect.width));
      renderShadowGlobe(runtime, latestRef.current);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => {
      observer.disconnect();
      onDebugState?.({ready: false, radiusPx: null});
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [onDebugState]);

  useEffect(() => {
    latestRef.current = {
      enabled,
      mapSession,
      onDebugState,
      opacity,
      orientation,
      solarState,
    };
    const runtime = runtimeRef.current;
    if (!runtime || runtime.renderQueued) return;
    runtime.renderQueued = true;
    requestAnimationFrame(() => {
      const current = runtimeRef.current;
      if (!current) return;
      current.renderQueued = false;
      renderShadowGlobe(current, latestRef.current);
    });
  }, [enabled, mapSession, onDebugState, opacity, orientation, solarState]);

  return (
    <canvas
      ref={canvasRef}
      className={`day-night-globe ${enabled ? "visible" : ""}`}
      data-layer="day-night-globe"
      aria-hidden="true"
    />
  );
}

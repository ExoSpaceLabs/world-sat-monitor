"use client";

import {useEffect, useRef} from "react";
import type {SolarState} from "../../domain/solar";
import {shadowAlpha} from "../../domain/solar";
import type {MapSession} from "../../domain/types";

const DEG = Math.PI / 180;
const MAX_OUTPUT_WIDTH = 1280;
const MIN_OUTPUT_WIDTH = 480;
const MAX_SAMPLE_WIDTH = 400;
const MIN_SAMPLE_WIDTH = 220;
const MAX_INTERACTION_SAMPLE_WIDTH = 150;
const MIN_INTERACTION_SAMPLE_WIDTH = 96;
const OUTPUT_WIDTH_SCALE = 0.75;
const SAMPLE_WIDTH_SCALE = 0.24;
const INTERACTION_SAMPLE_WIDTH_SCALE = 0.08;
const MIN_RENDER_INTERVAL_MS = 40;
const INTERACTION_PROJECTION_INTERVAL_MS = 90;
const PASSIVE_PROJECTION_INTERVAL_MS = 250;
const WHEEL_INTERACTION_RELEASE_MS = 140;
const ROUND_TRIP_TOLERANCE_PX = 2.5;

export type ShadowDebugState = {
  ready: boolean;
  sampleCount: number;
};

type ShadowState = {
  enabled: boolean;
  mapSession: MapSession | null;
  onDebugState?: (state: ShadowDebugState) => void;
  opacity: number;
  solarState: SolarState;
};

type ShadowRuntime = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  forceProjection: boolean;
  frameId: number;
  interactionActive: boolean;
  lastDebugReady: boolean | null;
  lastDebugSampleCount: number | null;
  lastProjectionAt: number;
  lastRenderAt: number;
  normals: Float32Array;
  projectionDirty: boolean;
  sampleCanvas: HTMLCanvasElement;
  sampleContext: CanvasRenderingContext2D;
  sampleCount: number;
  sampleImage: ImageData | null;
  validSamples: Uint8Array;
};

function reportDebug(
  runtime: ShadowRuntime,
  state: ShadowState,
  ready: boolean,
  sampleCount: number,
) {
  if (
    runtime.lastDebugReady === ready
    && runtime.lastDebugSampleCount === sampleCount
  ) return;
  runtime.lastDebugReady = ready;
  runtime.lastDebugSampleCount = sampleCount;
  state.onDebugState?.({ready, sampleCount});
}

function sampleWidthFor(bounds: DOMRect, interactionActive: boolean) {
  if (interactionActive) {
    return Math.min(
      MAX_INTERACTION_SAMPLE_WIDTH,
      Math.max(
        MIN_INTERACTION_SAMPLE_WIDTH,
        Math.round(bounds.width * INTERACTION_SAMPLE_WIDTH_SCALE),
      ),
    );
  }
  return Math.min(
    MAX_SAMPLE_WIDTH,
    Math.max(MIN_SAMPLE_WIDTH, Math.round(bounds.width * SAMPLE_WIDTH_SCALE)),
  );
}

function configureSampleGrid(
  runtime: ShadowRuntime,
  bounds: DOMRect,
  interactionActive: boolean,
) {
  const width = sampleWidthFor(bounds, interactionActive);
  const height = Math.max(1, Math.round(width * bounds.height / bounds.width));
  if (runtime.sampleCanvas.width === width && runtime.sampleCanvas.height === height) {
    runtime.projectionDirty = true;
    return;
  }

  runtime.sampleCanvas.width = width;
  runtime.sampleCanvas.height = height;
  const sampleTotal = width * height;
  runtime.normals = new Float32Array(sampleTotal * 3);
  runtime.validSamples = new Uint8Array(sampleTotal);
  runtime.sampleImage = runtime.sampleContext.createImageData(width, height);
  runtime.sampleCount = 0;
  runtime.projectionDirty = true;
}

function resizeBuffers(runtime: ShadowRuntime, bounds: DOMRect) {
  const outputWidth = Math.min(
    MAX_OUTPUT_WIDTH,
    Math.max(MIN_OUTPUT_WIDTH, Math.round(bounds.width * OUTPUT_WIDTH_SCALE)),
  );
  const outputHeight = Math.max(1, Math.round(outputWidth * bounds.height / bounds.width));
  if (runtime.canvas.width !== outputWidth || runtime.canvas.height !== outputHeight) {
    runtime.canvas.width = outputWidth;
    runtime.canvas.height = outputHeight;
  }
  configureSampleGrid(runtime, bounds, runtime.interactionActive);
}

function rebuildProjection(
  runtime: ShadowRuntime,
  state: ShadowState,
  bounds: DOMRect,
  timestamp: number,
) {
  const map = state.mapSession?.map;
  if (!map) return;

  const width = runtime.sampleCanvas.width;
  const height = runtime.sampleCanvas.height;
  const cssPerSampleX = bounds.width / width;
  const cssPerSampleY = bounds.height / height;
  runtime.validSamples.fill(0);
  let sampleCount = 0;

  // MapLibre remains the projection authority. This is intentionally cached:
  // rebuilding screen -> globe coordinates is far more expensive than updating
  // illumination for an already projected surface grid.
  for (let sy = 0; sy < height; sy += 1) {
    const cssY = (sy + 0.5) * cssPerSampleY;
    for (let sx = 0; sx < width; sx += 1) {
      const cssX = (sx + 0.5) * cssPerSampleX;
      const location = map.unproject([cssX, cssY]);
      if (!Number.isFinite(location.lng) || !Number.isFinite(location.lat)) continue;

      // Globe unprojection snaps sky pixels to the nearest horizon coordinate.
      // Reject those by checking that MapLibre projects the coordinate back to
      // the screen sample that requested it.
      const projected = map.project(location);
      if (
        Math.hypot(projected.x - cssX, projected.y - cssY)
        > ROUND_TRIP_TOLERANCE_PX
      ) continue;

      const latitude = location.lat * DEG;
      const longitude = location.lng * DEG;
      const latitudeRadius = Math.cos(latitude);
      const index = sy * width + sx;
      const normalOffset = index * 3;
      runtime.normals[normalOffset] = latitudeRadius * Math.cos(longitude);
      runtime.normals[normalOffset + 1] = latitudeRadius * Math.sin(longitude);
      runtime.normals[normalOffset + 2] = Math.sin(latitude);
      runtime.validSamples[index] = 1;
      sampleCount += 1;
    }
  }

  runtime.sampleCount = sampleCount;
  runtime.projectionDirty = false;
  runtime.lastProjectionAt = timestamp;
}

function renderShadow(
  runtime: ShadowRuntime,
  state: ShadowState,
  timestamp: number,
  forceProjection: boolean,
) {
  const {canvas, context, sampleCanvas, sampleContext} = runtime;

  const map = state.mapSession?.map;
  if (!map || canvas.width === 0 || canvas.height === 0) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    reportDebug(runtime, state, false, 0);
    return;
  }

  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    reportDebug(runtime, state, false, 0);
    return;
  }

  if (!state.enabled) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    reportDebug(runtime, state, true, runtime.sampleCount);
    return;
  }

  if (runtime.projectionDirty) {
    const projectionInterval = runtime.interactionActive
      ? INTERACTION_PROJECTION_INTERVAL_MS
      : PASSIVE_PROJECTION_INTERVAL_MS;
    const projectionDue = forceProjection
      || runtime.sampleCount === 0
      || timestamp - runtime.lastProjectionAt >= projectionInterval;
    if (projectionDue) rebuildProjection(runtime, state, bounds, timestamp);
  }

  if (runtime.sampleCount === 0 || !runtime.sampleImage) {
    reportDebug(runtime, state, false, 0);
    return;
  }

  const image = runtime.sampleImage;
  image.data.fill(0);
  const opacity = Math.max(0, Math.min(1, state.opacity));
  const sunLatitude = state.solarState.latitude * DEG;
  const sunLongitude = state.solarState.longitude * DEG;
  const sunLatitudeRadius = Math.cos(sunLatitude);
  const sunX = sunLatitudeRadius * Math.cos(sunLongitude);
  const sunY = sunLatitudeRadius * Math.sin(sunLongitude);
  const sunZ = Math.sin(sunLatitude);

  for (let index = 0; index < runtime.validSamples.length; index += 1) {
    if (runtime.validSamples[index] === 0) continue;
    const normalOffset = index * 3;
    const illumination = runtime.normals[normalOffset] * sunX
      + runtime.normals[normalOffset + 1] * sunY
      + runtime.normals[normalOffset + 2] * sunZ;
    const alpha = shadowAlpha(illumination, opacity);
    if (alpha <= 0) continue;

    const pixelOffset = index * 4;
    image.data[pixelOffset] = 0;
    image.data[pixelOffset + 1] = 3;
    image.data[pixelOffset + 2] = 10;
    image.data[pixelOffset + 3] = Math.round(alpha * 255);
  }

  sampleContext.putImageData(image, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sampleCanvas, 0, 0, canvas.width, canvas.height);
  reportDebug(runtime, state, true, runtime.sampleCount);
}

function queueRender(
  runtime: ShadowRuntime,
  stateRef: {current: ShadowState},
  forceProjection = false,
) {
  runtime.forceProjection ||= forceProjection;
  if (runtime.frameId !== 0) return;

  const renderFrame = (timestamp: number) => {
    if (timestamp - runtime.lastRenderAt < MIN_RENDER_INTERVAL_MS) {
      runtime.frameId = requestAnimationFrame(renderFrame);
      return;
    }
    runtime.frameId = 0;
    runtime.lastRenderAt = timestamp;
    const force = runtime.forceProjection;
    runtime.forceProjection = false;
    renderShadow(runtime, stateRef.current, timestamp, force);
  };

  runtime.frameId = requestAnimationFrame(renderFrame);
}

type DayNightLayerProps = {
  enabled: boolean;
  mapSession: MapSession | null;
  onDebugState?: (state: ShadowDebugState) => void;
  opacity: number;
  solarState: SolarState;
};

export function DayNightLayer({
  enabled,
  mapSession,
  onDebugState,
  opacity,
  solarState,
}: DayNightLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ShadowRuntime | null>(null);
  const latestRef = useRef<ShadowState>({
    enabled,
    mapSession,
    onDebugState,
    opacity,
    solarState,
  });

  useEffect(() => {
    latestRef.current = {
      enabled,
      mapSession,
      onDebugState,
      opacity,
      solarState,
    };
    const runtime = runtimeRef.current;
    if (runtime) queueRender(runtime, latestRef);
  }, [enabled, mapSession, onDebugState, opacity, solarState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const map = mapSession?.map;
    if (!canvas || !map) return;

    const context = canvas.getContext("2d", {alpha: true});
    const sampleCanvas = document.createElement("canvas");
    const sampleContext = sampleCanvas.getContext("2d", {alpha: true});
    if (!context || !sampleContext) {
      onDebugState?.({ready: false, sampleCount: 0});
      return;
    }

    const runtime: ShadowRuntime = {
      canvas,
      context,
      forceProjection: false,
      frameId: 0,
      interactionActive: false,
      lastDebugReady: null,
      lastDebugSampleCount: null,
      lastProjectionAt: 0,
      lastRenderAt: 0,
      normals: new Float32Array(),
      projectionDirty: true,
      sampleCanvas,
      sampleContext,
      sampleCount: 0,
      sampleImage: null,
      validSamples: new Uint8Array(),
    };
    runtimeRef.current = runtime;
    let wheelReleaseTimer = 0;

    const currentBounds = () => canvas.getBoundingClientRect();
    const setInteraction = (active: boolean) => {
      if (runtime.interactionActive === active) return;
      runtime.interactionActive = active;
      const bounds = currentBounds();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      configureSampleGrid(runtime, bounds, active);
      runtime.lastProjectionAt = 0;
      queueRender(runtime, latestRef, true);
    };
    const resize = () => {
      const rect = currentBounds();
      if (rect.width <= 0 || rect.height <= 0) return;
      resizeBuffers(runtime, rect);
      runtime.lastProjectionAt = 0;
      queueRender(runtime, latestRef, true);
    };
    const move = () => {
      runtime.projectionDirty = true;
      const interval = runtime.interactionActive
        ? INTERACTION_PROJECTION_INTERVAL_MS
        : PASSIVE_PROJECTION_INTERVAL_MS;
      if (performance.now() - runtime.lastProjectionAt >= interval) {
        queueRender(runtime, latestRef, true);
      }
    };
    const pointerDown = () => setInteraction(true);
    const pointerUp = () => setInteraction(false);
    const wheel = () => {
      setInteraction(true);
      window.clearTimeout(wheelReleaseTimer);
      wheelReleaseTimer = window.setTimeout(
        () => setInteraction(false),
        WHEEL_INTERACTION_RELEASE_MS,
      );
    };

    const observer = new ResizeObserver(resize);
    const mapCanvas = map.getCanvasContainer();
    observer.observe(canvas);
    map.on("move", move);
    mapCanvas.addEventListener("pointerdown", pointerDown);
    mapCanvas.addEventListener("wheel", wheel, {passive: true});
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    resize();

    return () => {
      observer.disconnect();
      map.off("move", move);
      mapCanvas.removeEventListener("pointerdown", pointerDown);
      mapCanvas.removeEventListener("wheel", wheel);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.clearTimeout(wheelReleaseTimer);
      if (runtime.frameId !== 0) cancelAnimationFrame(runtime.frameId);
      onDebugState?.({ready: false, sampleCount: 0});
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [mapSession, onDebugState]);

  return (
    <canvas
      ref={canvasRef}
      className={`day-night-globe ${enabled ? "visible" : ""}`}
      data-layer="day-night-globe"
      aria-hidden="true"
    />
  );
}

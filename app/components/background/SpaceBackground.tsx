"use client";

import {useEffect, useRef} from "react";
import type {SceneOrientation} from "../../domain/scene";
import {toOuterSphereRotation} from "../../domain/scene";
import type {SolarState} from "../../domain/solar";

const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 1024;
const MAX_RENDER_WIDTH = 720;
const FIELD_OF_VIEW = 68 * Math.PI / 180;

type RayField = {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
};

type SkyRuntime = {
  context: CanvasRenderingContext2D;
  height: number;
  image: ImageData;
  rays: RayField;
  renderQueued: boolean;
  starTexture: Uint8ClampedArray;
  width: number;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function createStarTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d", {willReadFrequently: true});
  if (!context) return new Uint8ClampedArray(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4);

  context.fillStyle = "#01050b";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const random = seededRandom(0x57534d);
  for (let index = 0; index < 2600; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = random() > 0.965 ? 1.6 : random() > 0.72 ? 0.85 : 0.48;
    const warmth = random();
    context.fillStyle = warmth > 0.92
      ? `rgba(255,238,200,${0.4 + random() * 0.5})`
      : `rgba(${185 + Math.floor(random() * 70)},${210 + Math.floor(random() * 45)},255,${0.28 + random() * 0.64})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function createRayField(width: number, height: number): RayField {
  const count = width * height;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const tangent = Math.tan(FIELD_OF_VIEW / 2);
  const aspect = width / height;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const index = py * width + px;
      const rayX = (2 * (px + 0.5) / width - 1) * tangent * aspect;
      const rayY = (1 - 2 * (py + 0.5) / height) * tangent;
      const inverseLength = 1 / Math.hypot(rayX, rayY, 1);
      x[index] = rayX * inverseLength;
      y[index] = rayY * inverseLength;
      z[index] = -inverseLength;
    }
  }
  return {x, y, z};
}

function drawSun(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  orientation: SceneOrientation,
  sun: SolarState,
) {
  const rotation = toOuterSphereRotation(orientation);
  const latitude = sun.latitude * Math.PI / 180;
  const longitude = sun.longitude * Math.PI / 180;
  const localX = Math.cos(latitude) * Math.sin(longitude);
  const localY = Math.sin(latitude);
  const localZ = -Math.cos(latitude) * Math.cos(longitude);

  const cosPitch = Math.cos(rotation.x);
  const sinPitch = Math.sin(rotation.x);
  const pitchedY = cosPitch * localY - sinPitch * localZ;
  const pitchedZ = sinPitch * localY + cosPitch * localZ;
  const cosYaw = Math.cos(rotation.y);
  const sinYaw = Math.sin(rotation.y);
  const worldX = cosYaw * localX + sinYaw * pitchedZ;
  const worldZ = -sinYaw * localX + cosYaw * pitchedZ;
  if (worldZ >= -0.02) return;

  const tangent = Math.tan(FIELD_OF_VIEW / 2);
  const aspect = width / height;
  const screenX = (worldX / -worldZ / (tangent * aspect) + 1) * width / 2;
  const screenY = (1 - pitchedY / -worldZ / tangent) * height / 2;
  if (screenX < -80 || screenX > width + 80 || screenY < -80 || screenY > height + 80) return;

  const radius = Math.max(22, width * 0.065);
  const glow = context.createRadialGradient(screenX, screenY, 1, screenX, screenY, radius);
  glow.addColorStop(0, "rgba(255,255,238,1)");
  glow.addColorStop(0.08, "rgba(255,242,180,1)");
  glow.addColorStop(0.22, "rgba(255,190,83,.55)");
  glow.addColorStop(0.58, "rgba(87,156,213,.12)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow;
  context.fillRect(screenX - radius, screenY - radius, radius * 2, radius * 2);
}

function renderSky(runtime: SkyRuntime, orientation: SceneOrientation, sun: SolarState) {
  const rotation = toOuterSphereRotation(orientation);
  const cosYaw = Math.cos(rotation.y);
  const sinYaw = Math.sin(rotation.y);
  const cosPitch = Math.cos(rotation.x);
  const sinPitch = Math.sin(rotation.x);
  const output = runtime.image.data;

  for (let index = 0; index < runtime.rays.x.length; index += 1) {
    const worldX = runtime.rays.x[index];
    const worldY = runtime.rays.y[index];
    const worldZ = runtime.rays.z[index];

    const localX = cosYaw * worldX - sinYaw * worldZ;
    const yawedZ = sinYaw * worldX + cosYaw * worldZ;
    const localY = cosPitch * worldY + sinPitch * yawedZ;
    const localZ = -sinPitch * worldY + cosPitch * yawedZ;
    const longitude = Math.atan2(localX, -localZ);
    const latitude = Math.asin(Math.max(-1, Math.min(1, localY)));
    const textureX = Math.floor((longitude / (Math.PI * 2) + 0.5) * TEXTURE_WIDTH) % TEXTURE_WIDTH;
    const textureY = Math.min(TEXTURE_HEIGHT - 1, Math.max(0, Math.floor((0.5 - latitude / Math.PI) * TEXTURE_HEIGHT)));
    const source = (textureY * TEXTURE_WIDTH + textureX) * 4;
    const target = index * 4;
    output[target] = runtime.starTexture[source];
    output[target + 1] = runtime.starTexture[source + 1];
    output[target + 2] = runtime.starTexture[source + 2];
    output[target + 3] = 255;
  }
  runtime.context.putImageData(runtime.image, 0, 0);
  drawSun(runtime.context, runtime.width, runtime.height, orientation, sun);
}

type SpaceBackgroundProps = {
  enabled: boolean;
  orientation: SceneOrientation;
  solarState: SolarState;
};

export function SpaceBackground({enabled, orientation, solarState}: SpaceBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<SkyRuntime | null>(null);
  const latestRef = useRef({orientation, solarState});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const starTexture = createStarTexture();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const width = Math.min(MAX_RENDER_WIDTH, Math.max(320, Math.round(rect.width)));
      const height = Math.max(180, Math.round(width * rect.height / rect.width));
      canvas.width = width;
      canvas.height = height;
      const runtime = {
        context,
        height,
        image: context.createImageData(width, height),
        rays: createRayField(width, height),
        renderQueued: false,
        starTexture,
        width,
      };
      runtimeRef.current = runtime;
      renderSky(runtime, latestRef.current.orientation, latestRef.current.solarState);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => {
      observer.disconnect();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestRef.current = {orientation, solarState};
    const runtime = runtimeRef.current;
    if (!runtime || runtime.renderQueued) return;
    runtime.renderQueued = true;
    requestAnimationFrame(() => {
      const current = runtimeRef.current;
      if (!current) return;
      current.renderQueued = false;
      renderSky(current, latestRef.current.orientation, latestRef.current.solarState);
    });
  }, [orientation, solarState]);

  return (
    <canvas
      ref={canvasRef}
      className={`space-background ${enabled ? "visible" : ""}`}
      aria-hidden="true"
      data-layer="space-background"
    />
  );
}

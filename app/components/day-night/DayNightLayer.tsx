"use client";

import {useEffect, useRef} from "react";
import type {SceneOrientation} from "../../domain/scene";
import {
  createCameraFrame,
  directionFromCoordinates,
  globeRadiusPixels,
  toCameraSpace,
} from "../../domain/scene";
import type {SolarState} from "../../domain/solar";
import {inertialSolarLongitude} from "../../domain/solar";
import {
  createFullscreenWebGL,
  destroyFullscreenWebGL,
  drawFullscreen,
  resizeWebGLCanvas,
  type FullscreenWebGL,
} from "../rendering/webgl";

const SHADOW_GLOBE_SCALE = 1.018;

const SHADOW_FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2 uCenter;
  uniform float uOpacity;
  uniform float uRadius;
  uniform vec3 uSun;

  void main() {
    vec2 sphere = (gl_FragCoord.xy - uCenter) / uRadius;
    float radialSquared = dot(sphere, sphere);
    if (radialSquared > 1.0) discard;

    vec3 normal = vec3(sphere, sqrt(max(0.0, 1.0 - radialSquared)));
    float illumination = dot(normal, uSun);
    float night = 1.0 - smoothstep(-0.012, 0.012, illumination);
    if (night < 0.002) discard;

    float alpha = uOpacity * night;
    vec3 shadowColor = vec3(0.0, 0.012, 0.04);
    gl_FragColor = vec4(shadowColor * alpha, alpha);
  }
`;

type ShadowRuntime = FullscreenWebGL & {
  canvas: HTMLCanvasElement;
  center: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  radius: WebGLUniformLocation | null;
  sun: WebGLUniformLocation | null;
};

type ShadowState = {
  enabled: boolean;
  opacity: number;
  orientation: SceneOrientation;
  solarState: SolarState;
};

function renderShadowGlobe(runtime: ShadowRuntime, state: ShadowState) {
  const {canvas, gl, program} = runtime;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!state.enabled || canvas.width === 0 || canvas.height === 0) return;

  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const pixelScale = canvas.width / bounds.width;
  const frame = createCameraFrame(state.orientation);
  const sunDirection = directionFromCoordinates(
    inertialSolarLongitude(state.solarState, state.orientation.earthRotationDegrees),
    state.solarState.latitude,
  );
  const cameraSun = toCameraSpace(sunDirection, frame);

  gl.useProgram(program);
  gl.uniform2f(runtime.center, canvas.width / 2, canvas.height / 2);
  gl.uniform1f(runtime.opacity, Math.max(0, Math.min(1, state.opacity)));
  gl.uniform1f(
    runtime.radius,
    globeRadiusPixels(state.orientation.zoom, state.orientation.latitude)
      * SHADOW_GLOBE_SCALE
      * pixelScale,
  );
  gl.uniform3f(runtime.sun, cameraSun.x, cameraSun.y, cameraSun.outward);
  drawFullscreen(runtime);
}

type DayNightLayerProps = {
  enabled: boolean;
  opacity: number;
  orientation: SceneOrientation;
  solarState: SolarState;
};

export function DayNightLayer({
  enabled,
  opacity,
  orientation,
  solarState,
}: DayNightLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ShadowRuntime | null>(null);
  const latestRef = useRef<ShadowState>({enabled, opacity, orientation, solarState});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fullscreen = createFullscreenWebGL(canvas, SHADOW_FRAGMENT_SHADER);
    if (!fullscreen) return;
    const runtime: ShadowRuntime = {
      ...fullscreen,
      canvas,
      center: fullscreen.gl.getUniformLocation(fullscreen.program, "uCenter"),
      opacity: fullscreen.gl.getUniformLocation(fullscreen.program, "uOpacity"),
      radius: fullscreen.gl.getUniformLocation(fullscreen.program, "uRadius"),
      sun: fullscreen.gl.getUniformLocation(fullscreen.program, "uSun"),
    };
    runtimeRef.current = runtime;

    const resize = () => {
      resizeWebGLCanvas(canvas);
      renderShadowGlobe(runtime, latestRef.current);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => {
      observer.disconnect();
      destroyFullscreenWebGL(runtime);
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestRef.current = {enabled, opacity, orientation, solarState};
    const runtime = runtimeRef.current;
    if (runtime) renderShadowGlobe(runtime, latestRef.current);
  }, [enabled, opacity, orientation, solarState]);

  return (
    <canvas
      ref={canvasRef}
      className={`day-night-globe ${enabled ? "visible" : ""}`}
      data-layer="day-night-globe"
      aria-hidden="true"
    />
  );
}

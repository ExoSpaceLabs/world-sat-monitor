"use client";

import {useEffect, useRef} from "react";
import type {SceneOrientation} from "../../domain/scene";
import {
  createCameraFrame,
  directionFromCoordinates,
} from "../../domain/scene";
import type {SolarState} from "../../domain/solar";
import {inertialSolarLongitude} from "../../domain/solar";
import {
  createFullscreenWebGL,
  createWebGLProgram,
  destroyFullscreenWebGL,
  drawFullscreen,
  resizeWebGLCanvas,
  type FullscreenWebGL,
} from "../rendering/webgl";

const STAR_COUNT = 5_200;
const STAR_STRIDE_FLOATS = 7;
const STAR_STRIDE_BYTES = STAR_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const FIELD_OF_VIEW_TANGENT = Math.tan(68 * Math.PI / 360);

const SKY_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform float uAspect;
  uniform vec3 uForward;
  uniform vec3 uRight;
  uniform vec3 uSun;
  uniform float uTangent;
  uniform vec3 uUp;

  void main() {
    vec2 screen = vUv * 2.0 - 1.0;
    vec3 ray = normalize(
      uRight * (screen.x * uTangent * uAspect) +
      uUp * (screen.y * uTangent) +
      uForward
    );

    vec3 color = vec3(0.0039, 0.0196, 0.0431);
    float separation = max(0.0, 1.0 - dot(ray, uSun));
    float wideGlow = exp(-separation * 180.0) * 0.12;
    float corona = exp(-separation * 1800.0) * 0.72;
    float disc = 1.0 - smoothstep(0.000015, 0.00006, separation);
    color += vec3(0.28, 0.48, 0.72) * wideGlow;
    color += vec3(1.0, 0.72, 0.28) * corona;
    color = mix(color, vec3(1.0, 0.965, 0.82), disc);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const STAR_VERTEX_SHADER = `
  precision highp float;

  attribute vec4 aStar;
  attribute vec3 aColor;
  uniform float uAspect;
  uniform vec3 uForward;
  uniform float uPixelRatio;
  uniform vec3 uRight;
  uniform float uTangent;
  uniform vec3 uUp;
  varying vec3 vColor;

  void main() {
    vec3 direction = aStar.xyz;
    float forward = dot(direction, uForward);
    float right = dot(direction, uRight);
    float up = dot(direction, uUp);
    vColor = aColor;

    if (forward <= 0.001) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    vec2 ndc = vec2(
      right / (forward * uTangent * uAspect),
      up / (forward * uTangent)
    );
    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = aStar.w * uPixelRatio;
  }
`;

const STAR_FRAGMENT_SHADER = `
  precision mediump float;

  varying vec3 vColor;

  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float distanceFromCenter = length(point);
    if (distanceFromCenter > 0.5) discard;
    float alpha = 1.0 - smoothstep(0.18, 0.5, distanceFromCenter);
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

type SkyRuntime = FullscreenWebGL & {
  aspect: WebGLUniformLocation | null;
  canvas: HTMLCanvasElement;
  forward: WebGLUniformLocation | null;
  right: WebGLUniformLocation | null;
  starAspect: WebGLUniformLocation | null;
  starBuffer: WebGLBuffer;
  starColor: number;
  starForward: WebGLUniformLocation | null;
  starPixelRatio: WebGLUniformLocation | null;
  starPosition: number;
  starProgram: WebGLProgram;
  starRight: WebGLUniformLocation | null;
  starTangent: WebGLUniformLocation | null;
  starUp: WebGLUniformLocation | null;
  sun: WebGLUniformLocation | null;
  tangent: WebGLUniformLocation | null;
  up: WebGLUniformLocation | null;
};

type SkyState = {
  enabled: boolean;
  orientation: SceneOrientation;
  solarState: SolarState;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

/**
 * Generates inertial unit vectors once. Stars are GPU point sprites rather
 * than a sampled texture, so their brightness cannot disappear through texture
 * minification or mip-level averaging.
 */
function createStarField() {
  const random = seededRandom(0x57534d);
  const data = new Float32Array(STAR_COUNT * STAR_STRIDE_FLOATS);

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const y = random() * 2 - 1;
    const longitude = random() * Math.PI * 2;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const bright = random();
    const warm = random() > 0.9;
    const offset = index * STAR_STRIDE_FLOATS;

    data[offset] = Math.sin(longitude) * horizontal;
    data[offset + 1] = y;
    data[offset + 2] = Math.cos(longitude) * horizontal;
    data[offset + 3] = bright > 0.993 ? 3.8 : bright > 0.94 ? 2.35 : 1.45;
    if (warm) {
      data[offset + 4] = 1.0;
      data[offset + 5] = 0.82 + random() * 0.12;
      data[offset + 6] = 0.58 + random() * 0.18;
    } else {
      data[offset + 4] = 0.72 + random() * 0.22;
      data[offset + 5] = 0.82 + random() * 0.15;
      data[offset + 6] = 1.0;
    }
  }
  return data;
}

function createStarRuntime(fullscreen: FullscreenWebGL) {
  const {gl} = fullscreen;
  const starProgram = createWebGLProgram(gl, STAR_VERTEX_SHADER, STAR_FRAGMENT_SHADER);
  const starBuffer = gl.createBuffer();
  if (!starBuffer) {
    gl.deleteProgram(starProgram);
    throw new Error("Unable to create star buffer");
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, starBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, createStarField(), gl.STATIC_DRAW);
  return {
    starAspect: gl.getUniformLocation(starProgram, "uAspect"),
    starBuffer,
    starColor: gl.getAttribLocation(starProgram, "aColor"),
    starForward: gl.getUniformLocation(starProgram, "uForward"),
    starPixelRatio: gl.getUniformLocation(starProgram, "uPixelRatio"),
    starPosition: gl.getAttribLocation(starProgram, "aStar"),
    starProgram,
    starRight: gl.getUniformLocation(starProgram, "uRight"),
    starTangent: gl.getUniformLocation(starProgram, "uTangent"),
    starUp: gl.getUniformLocation(starProgram, "uUp"),
  };
}

function drawStars(runtime: SkyRuntime, state: SkyState) {
  const {canvas, gl} = runtime;
  const frame = createCameraFrame(state.orientation);
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = bounds.width > 0 ? canvas.width / bounds.width : 1;

  gl.useProgram(runtime.starProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, runtime.starBuffer);
  gl.enableVertexAttribArray(runtime.starPosition);
  gl.vertexAttribPointer(
    runtime.starPosition,
    4,
    gl.FLOAT,
    false,
    STAR_STRIDE_BYTES,
    0,
  );
  gl.enableVertexAttribArray(runtime.starColor);
  gl.vertexAttribPointer(
    runtime.starColor,
    3,
    gl.FLOAT,
    false,
    STAR_STRIDE_BYTES,
    4 * Float32Array.BYTES_PER_ELEMENT,
  );
  gl.uniform1f(runtime.starAspect, canvas.width / canvas.height);
  gl.uniform3f(runtime.starForward, frame.forward.x, frame.forward.y, frame.forward.z);
  gl.uniform1f(runtime.starPixelRatio, pixelRatio);
  gl.uniform3f(runtime.starRight, frame.right.x, frame.right.y, frame.right.z);
  gl.uniform1f(runtime.starTangent, FIELD_OF_VIEW_TANGENT);
  gl.uniform3f(runtime.starUp, frame.up.x, frame.up.y, frame.up.z);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.POINTS, 0, STAR_COUNT);
  gl.disable(gl.BLEND);
}

function renderSky(runtime: SkyRuntime, state: SkyState) {
  const {canvas, gl, program} = runtime;
  gl.viewport(0, 0, canvas.width, canvas.height);
  if (!state.enabled) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return;
  }

  const frame = createCameraFrame(state.orientation);
  const sun = directionFromCoordinates(
    inertialSolarLongitude(state.solarState, state.orientation.earthRotationDegrees),
    state.solarState.latitude,
  );
  gl.useProgram(program);
  gl.uniform1f(runtime.aspect, canvas.width / canvas.height);
  gl.uniform3f(runtime.forward, frame.forward.x, frame.forward.y, frame.forward.z);
  gl.uniform3f(runtime.right, frame.right.x, frame.right.y, frame.right.z);
  gl.uniform3f(runtime.sun, sun.x, sun.y, sun.z);
  gl.uniform1f(runtime.tangent, FIELD_OF_VIEW_TANGENT);
  gl.uniform3f(runtime.up, frame.up.x, frame.up.y, frame.up.z);
  drawFullscreen(runtime);
  drawStars(runtime, state);
}

type SpaceBackgroundProps = {
  enabled: boolean;
  orientation: SceneOrientation;
  solarState: SolarState;
};

export function SpaceBackground({enabled, orientation, solarState}: SpaceBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<SkyRuntime | null>(null);
  const latestRef = useRef<SkyState>({enabled, orientation, solarState});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fullscreen = createFullscreenWebGL(canvas, SKY_FRAGMENT_SHADER);
    if (!fullscreen) return;
    const starRuntime = createStarRuntime(fullscreen);
    const runtime: SkyRuntime = {
      ...fullscreen,
      ...starRuntime,
      aspect: fullscreen.gl.getUniformLocation(fullscreen.program, "uAspect"),
      canvas,
      forward: fullscreen.gl.getUniformLocation(fullscreen.program, "uForward"),
      right: fullscreen.gl.getUniformLocation(fullscreen.program, "uRight"),
      sun: fullscreen.gl.getUniformLocation(fullscreen.program, "uSun"),
      tangent: fullscreen.gl.getUniformLocation(fullscreen.program, "uTangent"),
      up: fullscreen.gl.getUniformLocation(fullscreen.program, "uUp"),
    };
    runtimeRef.current = runtime;

    const resize = () => {
      resizeWebGLCanvas(canvas);
      renderSky(runtime, latestRef.current);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => {
      observer.disconnect();
      fullscreen.gl.deleteBuffer(runtime.starBuffer);
      fullscreen.gl.deleteProgram(runtime.starProgram);
      destroyFullscreenWebGL(fullscreen);
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestRef.current = {enabled, orientation, solarState};
    const runtime = runtimeRef.current;
    if (runtime) renderSky(runtime, latestRef.current);
  }, [enabled, orientation, solarState]);

  return (
    <canvas
      ref={canvasRef}
      className={`space-background ${enabled ? "visible" : ""}`}
      aria-hidden="true"
      data-layer="space-background"
    />
  );
}

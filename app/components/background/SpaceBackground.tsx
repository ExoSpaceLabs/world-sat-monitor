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
  destroyFullscreenWebGL,
  drawFullscreen,
  resizeWebGLCanvas,
  type FullscreenWebGL,
} from "../rendering/webgl";

const TEXTURE_WIDTH = 4096;
const TEXTURE_HEIGHT = 2048;
const FIELD_OF_VIEW_TANGENT = Math.tan(68 * Math.PI / 360);

const SKY_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform float uAspect;
  uniform vec3 uForward;
  uniform vec3 uRight;
  uniform vec3 uSun;
  uniform sampler2D uTexture;
  uniform float uTangent;
  uniform vec3 uUp;

  const float PI = 3.141592653589793;

  void main() {
    vec2 screen = vUv * 2.0 - 1.0;
    vec3 ray = normalize(
      uRight * (screen.x * uTangent * uAspect) +
      uUp * (screen.y * uTangent) +
      uForward
    );
    float longitude = atan(ray.x, ray.z);
    float latitude = asin(clamp(ray.y, -1.0, 1.0));
    vec2 textureUv = vec2(longitude / (2.0 * PI) + 0.5, 0.5 - latitude / PI);
    vec3 color = texture2D(uTexture, textureUv).rgb;

    float separation = max(0.0, 1.0 - dot(ray, uSun));
    float wideGlow = exp(-separation * 180.0) * 0.12;
    float corona = exp(-separation * 1800.0) * 0.72;
    float disc = smoothstep(0.00006, 0.000015, separation);
    color += vec3(0.28, 0.48, 0.72) * wideGlow;
    color += vec3(1.0, 0.72, 0.28) * corona;
    color = mix(color, vec3(1.0, 0.965, 0.82), disc);
    gl_FragColor = vec4(color, 1.0);
  }
`;

type SkyRuntime = FullscreenWebGL & {
  aspect: WebGLUniformLocation | null;
  canvas: HTMLCanvasElement;
  forward: WebGLUniformLocation | null;
  right: WebGLUniformLocation | null;
  sun: WebGLUniformLocation | null;
  tangent: WebGLUniformLocation | null;
  texture: WebGLTexture;
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

function createStarTextureCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.fillStyle = "#01050b";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const random = seededRandom(0x57534d);

  context.globalCompositeOperation = "lighter";
  for (let index = 0; index < 8_500; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const bright = random();
    const radius = bright > 0.992 ? 2.25 : bright > 0.94 ? 1.15 : 0.48;
    const alpha = bright > 0.992 ? 0.95 : 0.28 + random() * 0.58;
    const warm = random() > 0.91;

    if (radius > 1) {
      const glow = context.createRadialGradient(x, y, 0, x, y, radius * 3.2);
      glow.addColorStop(0, warm ? `rgba(255,238,205,${alpha})` : `rgba(214,231,255,${alpha})`);
      glow.addColorStop(0.22, warm ? `rgba(255,190,112,${alpha * 0.55})` : `rgba(133,190,255,${alpha * 0.48})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = glow;
      context.fillRect(x - radius * 3.2, y - radius * 3.2, radius * 6.4, radius * 6.4);
    } else {
      context.fillStyle = warm
        ? `rgba(255,232,196,${alpha})`
        : `rgba(190,218,255,${alpha})`;
      context.fillRect(x, y, 1, 1);
    }
  }
  context.globalCompositeOperation = "source-over";
  return canvas;
}

function createTexture(runtime: FullscreenWebGL) {
  const {gl} = runtime;
  const texture = gl.createTexture();
  if (!texture) throw new Error("Unable to create star texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    createStarTextureCanvas(),
  );
  return texture;
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
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, runtime.texture);
  gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);
  drawFullscreen(runtime);
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
    const texture = createTexture(fullscreen);
    const runtime: SkyRuntime = {
      ...fullscreen,
      aspect: fullscreen.gl.getUniformLocation(fullscreen.program, "uAspect"),
      canvas,
      forward: fullscreen.gl.getUniformLocation(fullscreen.program, "uForward"),
      right: fullscreen.gl.getUniformLocation(fullscreen.program, "uRight"),
      sun: fullscreen.gl.getUniformLocation(fullscreen.program, "uSun"),
      tangent: fullscreen.gl.getUniformLocation(fullscreen.program, "uTangent"),
      texture,
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
      fullscreen.gl.deleteTexture(texture);
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

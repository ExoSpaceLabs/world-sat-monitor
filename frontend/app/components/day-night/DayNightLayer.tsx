"use client";

import {useEffect, useRef} from "react";
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import type {SolarState} from "../../domain/solar";
import type {MapSession} from "../../domain/types";

const DEG = Math.PI / 180;
const LAYER_ID = "day-night-illumination";
const MESH_GRANULARITY = 128;

type IlluminationState = {
  enabled: boolean;
  opacity: number;
  solarState: SolarState;
};

export type ShadowDebugState = {
  ready: boolean;
  triangleCount: number;
};

type ProgramState = {
  aPos: number;
  program: WebGLProgram;
  uniforms: {
    clippingPlane: WebGLUniformLocation | null;
    fallbackMatrix: WebGLUniformLocation | null;
    mainMatrix: WebGLUniformLocation | null;
    opacity: WebGLUniformLocation | null;
    sun: WebGLUniformLocation | null;
    tileMercatorCoords: WebGLUniformLocation | null;
    transition: WebGLUniformLocation | null;
  };
};

type RenderState = {
  arrayBuffer: WebGLBuffer | null;
  blend: boolean;
  blendDstAlpha: number;
  blendDstRgb: number;
  blendEquationAlpha: number;
  blendEquationRgb: number;
  blendSrcAlpha: number;
  blendSrcRgb: number;
  cullFace: boolean;
  depthMask: boolean;
  depthTest: boolean;
  program: WebGLProgram | null;
  stencilTest: boolean;
  vertexArray: WebGLVertexArrayObject | null;
};

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate illumination shader");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "Unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Unable to allocate illumination program");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "Unknown illumination link error";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function captureRenderState(gl: WebGL2RenderingContext): RenderState {
  return {
    arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    blend: gl.isEnabled(gl.BLEND),
    blendDstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
    blendDstRgb: gl.getParameter(gl.BLEND_DST_RGB) as number,
    blendEquationAlpha: gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number,
    blendEquationRgb: gl.getParameter(gl.BLEND_EQUATION_RGB) as number,
    blendSrcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
    blendSrcRgb: gl.getParameter(gl.BLEND_SRC_RGB) as number,
    cullFace: gl.isEnabled(gl.CULL_FACE),
    depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
    depthTest: gl.isEnabled(gl.DEPTH_TEST),
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    stencilTest: gl.isEnabled(gl.STENCIL_TEST),
    vertexArray: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
  };
}

function restoreCapability(
  gl: WebGL2RenderingContext,
  capability: number,
  enabled: boolean,
) {
  if (enabled) gl.enable(capability);
  else gl.disable(capability);
}

function restoreRenderState(gl: WebGL2RenderingContext, state: RenderState) {
  gl.bindVertexArray(state.vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
  gl.useProgram(state.program);
  gl.depthMask(state.depthMask);
  gl.blendEquationSeparate(state.blendEquationRgb, state.blendEquationAlpha);
  gl.blendFuncSeparate(
    state.blendSrcRgb,
    state.blendDstRgb,
    state.blendSrcAlpha,
    state.blendDstAlpha,
  );
  restoreCapability(gl, gl.DEPTH_TEST, state.depthTest);
  restoreCapability(gl, gl.STENCIL_TEST, state.stencilTest);
  restoreCapability(gl, gl.CULL_FACE, state.cullFace);
  restoreCapability(gl, gl.BLEND, state.blend);
}

function createProgram(
  gl: WebGL2RenderingContext,
  shaderData: CustomRenderMethodInput["shaderData"],
  extent: number,
) {
  // MapLibre injects PI and all projection helpers in vertexShaderPrelude.
  // Do not redeclare PI here: doing so makes the runtime GLSL compiler reject
  // the shader even though TypeScript/CI cannot see the generated source.
  const vertexSource = `#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}

in vec2 a_pos;
out highp vec3 v_surface_normal;

const highp float TILE_EXTENT = ${extent.toFixed(1)};

highp vec3 mercatorEarthNormal(vec2 tilePosition) {
  highp float mercatorX = tilePosition.x / TILE_EXTENT;
  highp float mercatorY = clamp(tilePosition.y / TILE_EXTENT, 0.0, 1.0);
  highp float longitude = mercatorX * 2.0 * PI - PI;
  highp float latitude = atan(sinh(PI * (1.0 - 2.0 * mercatorY)));
  highp float latitudeRadius = cos(latitude);
  return vec3(
    latitudeRadius * cos(longitude),
    latitudeRadius * sin(longitude),
    sin(latitude)
  );
}

void main() {
#ifdef GLOBE
  // Reuse MapLibre's own sphere conversion, including its special pole
  // vertices. MapLibre sphere axes are [lon90, north, lon0], while the solar
  // model uses conventional ECEF [lon0, lon90, north].
  highp vec3 mapSphere = projectToSphere(a_pos, a_pos);
  v_surface_normal = vec3(mapSphere.z, mapSphere.x, mapSphere.y);
  gl_Position = projectTile(a_pos, a_pos);
#else
  highp vec2 position = a_pos;
  position.y = clamp(position.y, 0.0, TILE_EXTENT);
  v_surface_normal = mercatorEarthNormal(position);
  gl_Position = projectTile(position);
#endif
}`;

  const fragmentSource = `#version 300 es
precision highp float;

in highp vec3 v_surface_normal;
uniform highp vec3 u_sun_ecef;
uniform highp float u_shadow_opacity;
out highp vec4 fragColor;

void main() {
  highp float illumination = dot(normalize(v_surface_normal), normalize(u_sun_ecef));
  highp float night = 1.0 - smoothstep(-0.025, 0.025, illumination);
  highp float alpha = clamp(u_shadow_opacity, 0.0, 1.0) * night;

  // Premultiplied black. The blend state below multiplies the existing
  // MapLibre framebuffer by (1 - alpha) while preserving its alpha channel.
  fragColor = vec4(0.0, 0.0, 0.0, alpha);
}`;

  const program = linkProgram(gl, vertexSource, fragmentSource);
  return {
    aPos: gl.getAttribLocation(program, "a_pos"),
    program,
    uniforms: {
      clippingPlane: gl.getUniformLocation(program, "u_projection_clipping_plane"),
      fallbackMatrix: gl.getUniformLocation(program, "u_projection_fallback_matrix"),
      mainMatrix: gl.getUniformLocation(program, "u_projection_matrix"),
      opacity: gl.getUniformLocation(program, "u_shadow_opacity"),
      sun: gl.getUniformLocation(program, "u_sun_ecef"),
      tileMercatorCoords: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
      transition: gl.getUniformLocation(program, "u_projection_transition"),
    },
  } satisfies ProgramState;
}

class GlobeIlluminationLayer implements CustomLayerInterface {
  readonly id = LAYER_ID;
  readonly type = "custom" as const;
  // The day/night mask is a framebuffer compositor, not scene geometry. Keep
  // it in MapLibre's normal 2D custom-layer pass so its execution is identical
  // whether or not another 3D custom layer (such as a selected orbit) exists.
  readonly renderingMode = "2d" as const;

  private readonly programs = new Map<string, ProgramState>();
  private readonly triangleCount: number;
  private indexBuffer: WebGLBuffer | null = null;
  private indexCount: number;
  private map: MapLibreMap | null = null;
  private pendingMesh: ReturnType<MapSession["maplibre"]["createTileMesh"]> | null;
  private ready = false;
  private state: IlluminationState;
  private vertexArray: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;

  constructor(
    initialState: IlluminationState,
    private readonly maplibre: MapSession["maplibre"],
    private readonly onDebugState?: (state: ShadowDebugState) => void,
  ) {
    this.state = initialState;
    this.pendingMesh = this.maplibre.createTileMesh({
      granularity: MESH_GRANULARITY,
      extendToNorthPole: true,
      extendToSouthPole: true,
    }, "16bit");
    this.indexCount = this.pendingMesh.indices.byteLength / Uint16Array.BYTES_PER_ELEMENT;
    this.triangleCount = this.indexCount / 3;
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    const mesh = this.pendingMesh;
    if (!mesh) throw new Error("Illumination mesh is unavailable");

    this.vertexArray = gl.createVertexArray();
    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    if (!this.vertexArray || !this.vertexBuffer || !this.indexBuffer) {
      this.destroy(gl);
      throw new Error("Unable to allocate illumination mesh buffers");
    }

    const previousVertexArray = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const previousArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(previousVertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);

    this.pendingMesh = null;
    if (this.state.enabled) map.triggerRepaint();
  }

  private getProgram(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const cached = this.programs.get(args.shaderData.variantName);
    if (cached) return cached;

    const program = createProgram(gl, args.shaderData, this.maplibre.EXTENT);
    this.programs.set(args.shaderData.variantName, program);
    return program;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.state.enabled || !this.vertexArray || !this.vertexBuffer || !this.indexBuffer) return;

    const previousState = captureRenderState(gl);
    try {
      const shader = this.getProgram(gl, args);
      const projection = args.getProjectionData({
        tileID: {wrap: 0, canonical: {x: 0, y: 0, z: 0}},
        applyGlobeMatrix: true,
      });
      const sunLatitude = this.state.solarState.latitude * DEG;
      const sunLongitude = this.state.solarState.longitude * DEG;
      const latitudeRadius = Math.cos(sunLatitude);

      // Illumination is a compositing overlay. It must never read from or write
      // to the shared depth buffer, and it must leave all touched WebGL state
      // exactly as it found it for whichever layer MapLibre renders next.
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.useProgram(shader.program);

      gl.uniformMatrix4fv(shader.uniforms.fallbackMatrix, false, projection.fallbackMatrix);
      gl.uniformMatrix4fv(shader.uniforms.mainMatrix, false, projection.mainMatrix);
      gl.uniform4f(shader.uniforms.tileMercatorCoords, ...projection.tileMercatorCoords);
      gl.uniform4f(shader.uniforms.clippingPlane, ...projection.clippingPlane);
      gl.uniform1f(shader.uniforms.transition, projection.projectionTransition);
      gl.uniform1f(shader.uniforms.opacity, this.state.opacity);
      gl.uniform3f(
        shader.uniforms.sun,
        latitudeRadius * Math.cos(sunLongitude),
        latitudeRadius * Math.sin(sunLongitude),
        Math.sin(sunLatitude),
      );

      gl.bindVertexArray(this.vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.enableVertexAttribArray(shader.aPos);
      gl.vertexAttribPointer(shader.aPos, 2, gl.SHORT, false, 0, 0);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

      if (!this.ready) {
        this.ready = true;
        this.onDebugState?.({ready: true, triangleCount: this.triangleCount});
      }
    } catch (error) {
      if (this.ready) this.ready = false;
      this.onDebugState?.({ready: false, triangleCount: this.triangleCount});
      console.error("Unable to render globe illumination", error);
    } finally {
      restoreRenderState(gl, previousState);
    }
  }

  update(nextState: IlluminationState) {
    const current = this.state;
    const visualChange = current.enabled !== nextState.enabled
      || (nextState.enabled && (
        current.opacity !== nextState.opacity
        || current.solarState.latitude !== nextState.solarState.latitude
        || current.solarState.longitude !== nextState.solarState.longitude
      ));
    this.state = nextState;
    if (visualChange) this.map?.triggerRepaint();
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.destroy(gl);
    this.map = null;
    this.ready = false;
    this.onDebugState?.({ready: false, triangleCount: 0});
  }

  private destroy(gl: WebGL2RenderingContext) {
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    if (this.vertexArray) gl.deleteVertexArray(this.vertexArray);
    for (const shader of this.programs.values()) gl.deleteProgram(shader.program);
    this.programs.clear();
    this.vertexArray = null;
    this.vertexBuffer = null;
    this.indexBuffer = null;
  }
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
  const layerRef = useRef<GlobeIlluminationLayer | null>(null);

  useEffect(() => {
    const map = mapSession?.map;
    if (!mapSession || !map) return;

    const layer = new GlobeIlluminationLayer(
      {enabled, opacity, solarState},
      mapSession.maplibre,
      onDebugState,
    );
    layerRef.current = layer;

    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      map.addLayer(layer);
    } catch (error) {
      layerRef.current = null;
      onDebugState?.({ready: false, triangleCount: 0});
      console.error("Unable to install globe illumination layer", error);
    }

    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [mapSession, onDebugState]);

  useEffect(() => {
    layerRef.current?.update({enabled, opacity, solarState});
  }, [enabled, opacity, solarState]);

  return null;
}

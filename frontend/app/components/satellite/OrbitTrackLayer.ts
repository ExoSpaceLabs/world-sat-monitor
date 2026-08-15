import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import type {OrbitDisplaySettings, OrbitTrackMode} from "../../domain/settings";
import type {MapLibreModule} from "../../domain/types";
import {
  EARTH_RADIUS_KM,
  headingEndpoint,
  type Satellite,
  type SatelliteTrackPoint,
} from "../../domain/satellite";

export const ORBIT_TRACK_LAYER_ID = "satellite-orbit-track";

const DEG = Math.PI / 180;
const HEADING_VECTOR_LENGTH_KM = 1750;
const HEADING_VECTOR_SAMPLES = 32;
const VERTEX_STRIDE_FLOATS = 4;
const VERTEX_STRIDE_BYTES = VERTEX_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

const HISTORY_COLOR = [0.341, 0.894, 0.627, 0.92] as const;
const PREDICTION_COLOR = [0.345, 0.804, 0.867, 0.94] as const;
const HEADING_COLOR = [0.541, 1.0, 0.776, 1.0] as const;

const PREDICTION_DASH_PERIOD_KM = 320;
const PREDICTION_DASH_ON_KM = 185;
const HEADING_DASH_PERIOD_KM = 115;
const HEADING_DASH_ON_KM = 34;

type WorldPoint = {
  altitude: number;
  lat: number;
  lon: number;
};

type LineRange = {
  count: number;
  first: number;
};

type PathGeometry = {
  ranges: LineRange[];
  vertices: Float32Array;
};

type LayerGeometry = {
  heading: PathGeometry;
  history: PathGeometry;
  prediction: PathGeometry;
};

type OrbitTrackState = {
  satellite: Satellite;
  settings: OrbitDisplaySettings;
  track: SatelliteTrackPoint[];
};

type BufferState = {
  heading: WebGLBuffer;
  history: WebGLBuffer;
  prediction: WebGLBuffer;
};

type ProgramState = {
  attributes: {
    distance: number;
    elevation: number;
    position: number;
  };
  program: WebGLProgram;
  uniforms: {
    clippingPlane: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
    dashOn: WebGLUniformLocation | null;
    dashPeriod: WebGLUniformLocation | null;
    fallbackMatrix: WebGLUniformLocation | null;
    mainMatrix: WebGLUniformLocation | null;
    tileMercatorCoords: WebGLUniformLocation | null;
    transition: WebGLUniformLocation | null;
  };
};

function normalizeLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function centralAngle(left: WorldPoint, right: WorldPoint) {
  const lat1 = left.lat * DEG;
  const lat2 = right.lat * DEG;
  const deltaLat = (right.lat - left.lat) * DEG;
  const deltaLon = normalizeLongitude(right.lon - left.lon) * DEG;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const a = sinLat * sinLat
    + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function segmentDistanceKm(left: WorldPoint, right: WorldPoint, mode: OrbitTrackMode) {
  const altitude = mode === "orbit" ? (left.altitude + right.altitude) / 2 : 0;
  return centralAngle(left, right) * (EARTH_RADIUS_KM + altitude);
}

function splitAtDateline(points: WorldPoint[]) {
  const strips: WorldPoint[][] = [];
  let current: WorldPoint[] = [];
  let previousLongitude: number | null = null;

  for (const raw of points) {
    const point = {...raw, lon: normalizeLongitude(raw.lon)};
    if (previousLongitude !== null && Math.abs(point.lon - previousLongitude) > 180) {
      if (current.length >= 2) strips.push(current);
      current = [];
    }
    current.push(point);
    previousLongitude = point.lon;
  }

  if (current.length >= 2) strips.push(current);
  return strips;
}

function buildGeometry(
  maplibre: MapLibreModule,
  points: WorldPoint[],
  mode: OrbitTrackMode,
): PathGeometry {
  const values: number[] = [];
  const ranges: LineRange[] = [];

  for (const strip of splitAtDateline(points)) {
    const first = values.length / VERTEX_STRIDE_FLOATS;
    let distance = 0;
    let previous: WorldPoint | null = null;

    for (const point of strip) {
      if (previous) distance += segmentDistanceKm(previous, point, mode);
      const coordinate = maplibre.MercatorCoordinate.fromLngLat({
        lng: point.lon,
        lat: point.lat,
      });
      values.push(
        coordinate.x,
        coordinate.y,
        mode === "orbit" ? Math.max(0, point.altitude) * 1000 : 0,
        distance,
      );
      previous = point;
    }

    const count = values.length / VERTEX_STRIDE_FLOATS - first;
    if (count >= 2) ranges.push({first, count});
  }

  return {vertices: new Float32Array(values), ranges};
}

function trackSegment(
  track: SatelliteTrackPoint[],
  segment: SatelliteTrackPoint["segment"],
  satellite: Satellite,
): WorldPoint[] {
  const points = track
    .filter((point) => point.segment === segment)
    .map((point) => ({
      altitude: point.altitude,
      lat: point.lat,
      lon: point.lon,
    }));
  const current = {
    altitude: satellite.altitude,
    lat: satellite.lat,
    lon: satellite.lon,
  };
  return segment === "history" ? [...points, current] : [current, ...points];
}

function headingVector(satellite: Satellite): WorldPoint[] {
  const points: WorldPoint[] = [];
  for (let sample = 0; sample <= HEADING_VECTOR_SAMPLES; sample += 1) {
    const distance = HEADING_VECTOR_LENGTH_KM * sample / HEADING_VECTOR_SAMPLES;
    if (distance === 0) {
      points.push({
        altitude: satellite.altitude,
        lat: satellite.lat,
        lon: satellite.lon,
      });
      continue;
    }
    const [lon, lat] = headingEndpoint(
      satellite.lon,
      satellite.lat,
      satellite.heading,
      distance,
    );
    points.push({altitude: satellite.altitude, lat, lon});
  }
  return points;
}

function buildLayerGeometry(
  maplibre: MapLibreModule,
  state: OrbitTrackState,
): LayerGeometry {
  const mode = state.settings.path.mode;
  return {
    history: buildGeometry(
      maplibre,
      trackSegment(state.track, "history", state.satellite),
      mode,
    ),
    prediction: buildGeometry(
      maplibre,
      trackSegment(state.track, "prediction", state.satellite),
      mode,
    ),
    heading: buildGeometry(maplibre, headingVector(state.satellite), mode),
  };
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate orbit-track shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "Unknown orbit-track shader error";
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
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("Unable to allocate orbit-track program");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "Unknown orbit-track link error";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function createProgram(
  gl: WebGL2RenderingContext,
  shaderData: CustomRenderMethodInput["shaderData"],
): ProgramState {
  const vertexSource = `#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}

in vec2 a_pos;
in float a_elevation;
in float a_distance;
out highp float v_distance;

void main() {
  v_distance = a_distance;
  gl_Position = projectTileFor3D(a_pos, a_elevation);
}`;

  const fragmentSource = `#version 300 es
precision highp float;

in highp float v_distance;
uniform highp vec4 u_color;
uniform highp float u_dash_period;
uniform highp float u_dash_on;
out highp vec4 fragColor;

void main() {
  if (u_dash_period > 0.0 && mod(v_distance, u_dash_period) > u_dash_on) discard;
  fragColor = u_color;
}`;

  const program = linkProgram(gl, vertexSource, fragmentSource);
  return {
    program,
    attributes: {
      position: gl.getAttribLocation(program, "a_pos"),
      elevation: gl.getAttribLocation(program, "a_elevation"),
      distance: gl.getAttribLocation(program, "a_distance"),
    },
    uniforms: {
      clippingPlane: gl.getUniformLocation(program, "u_projection_clipping_plane"),
      color: gl.getUniformLocation(program, "u_color"),
      dashOn: gl.getUniformLocation(program, "u_dash_on"),
      dashPeriod: gl.getUniformLocation(program, "u_dash_period"),
      fallbackMatrix: gl.getUniformLocation(program, "u_projection_fallback_matrix"),
      mainMatrix: gl.getUniformLocation(program, "u_projection_matrix"),
      tileMercatorCoords: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
      transition: gl.getUniformLocation(program, "u_projection_transition"),
    },
  };
}

function drawGeometry(
  gl: WebGL2RenderingContext,
  program: ProgramState,
  buffer: WebGLBuffer,
  geometry: PathGeometry,
  color: readonly [number, number, number, number],
  width: number,
  dashPeriod: number,
  dashOn: number,
) {
  if (geometry.ranges.length === 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(program.attributes.position);
  gl.enableVertexAttribArray(program.attributes.elevation);
  gl.enableVertexAttribArray(program.attributes.distance);
  gl.vertexAttribPointer(
    program.attributes.position,
    2,
    gl.FLOAT,
    false,
    VERTEX_STRIDE_BYTES,
    0,
  );
  gl.vertexAttribPointer(
    program.attributes.elevation,
    1,
    gl.FLOAT,
    false,
    VERTEX_STRIDE_BYTES,
    2 * Float32Array.BYTES_PER_ELEMENT,
  );
  gl.vertexAttribPointer(
    program.attributes.distance,
    1,
    gl.FLOAT,
    false,
    VERTEX_STRIDE_BYTES,
    3 * Float32Array.BYTES_PER_ELEMENT,
  );
  gl.uniform4f(program.uniforms.color, ...color);
  gl.uniform1f(program.uniforms.dashPeriod, dashPeriod);
  gl.uniform1f(program.uniforms.dashOn, dashOn);

  const range = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) as Float32Array;
  gl.lineWidth(Math.max(range[0] ?? 1, Math.min(width, range[1] ?? 1)));
  for (const line of geometry.ranges) {
    gl.drawArrays(gl.LINE_STRIP, line.first, line.count);
  }
}

export class OrbitTrackLayer implements CustomLayerInterface {
  readonly id = ORBIT_TRACK_LAYER_ID;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private buffers: BufferState | null = null;
  private geometry: LayerGeometry;
  private geometryDirty = true;
  private map: MapLibreMap | null = null;
  private readonly programs = new Map<string, ProgramState>();

  constructor(
    private state: OrbitTrackState,
    private readonly maplibre: MapLibreModule,
  ) {
    this.geometry = buildLayerGeometry(maplibre, state);
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    const history = gl.createBuffer();
    const prediction = gl.createBuffer();
    const heading = gl.createBuffer();
    if (!history || !prediction || !heading) {
      if (history) gl.deleteBuffer(history);
      if (prediction) gl.deleteBuffer(prediction);
      if (heading) gl.deleteBuffer(heading);
      throw new Error("Unable to allocate orbit-track buffers");
    }
    this.buffers = {history, prediction, heading};
    this.geometryDirty = true;
    map.triggerRepaint();
  }

  update(state: OrbitTrackState) {
    this.state = state;
    this.geometry = buildLayerGeometry(this.maplibre, state);
    this.geometryDirty = true;
    this.map?.triggerRepaint();
  }

  private getProgram(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const cached = this.programs.get(args.shaderData.variantName);
    if (cached) return cached;
    const program = createProgram(gl, args.shaderData);
    this.programs.set(args.shaderData.variantName, program);
    return program;
  }

  private uploadGeometry(gl: WebGL2RenderingContext) {
    if (!this.buffers || !this.geometryDirty) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.history);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.history.vertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.prediction);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.prediction.vertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.heading);
    gl.bufferData(gl.ARRAY_BUFFER, this.geometry.heading.vertices, gl.DYNAMIC_DRAW);
    this.geometryDirty = false;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.buffers) return;
    if (!this.state.settings.path.enabled && !this.state.settings.direction_vector_enabled) return;

    try {
      this.uploadGeometry(gl);
      const program = this.getProgram(gl, args);
      const projection = args.defaultProjectionData;

      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      // projectTileFor3D performs globe horizon clipping. Keeping depth writes
      // disabled lets the overlay remain readable over the basemap without
      // corrupting MapLibre's shared depth buffer.
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program.program);

      gl.uniformMatrix4fv(program.uniforms.fallbackMatrix, false, projection.fallbackMatrix);
      gl.uniformMatrix4fv(program.uniforms.mainMatrix, false, projection.mainMatrix);
      gl.uniform4f(program.uniforms.tileMercatorCoords, ...projection.tileMercatorCoords);
      gl.uniform4f(program.uniforms.clippingPlane, ...projection.clippingPlane);
      gl.uniform1f(program.uniforms.transition, projection.projectionTransition);

      if (this.state.settings.path.enabled) {
        drawGeometry(
          gl,
          program,
          this.buffers.history,
          this.geometry.history,
          HISTORY_COLOR,
          3,
          0,
          0,
        );
        drawGeometry(
          gl,
          program,
          this.buffers.prediction,
          this.geometry.prediction,
          PREDICTION_COLOR,
          3,
          PREDICTION_DASH_PERIOD_KM,
          PREDICTION_DASH_ON_KM,
        );
      }
      if (this.state.settings.direction_vector_enabled) {
        drawGeometry(
          gl,
          program,
          this.buffers.heading,
          this.geometry.heading,
          HEADING_COLOR,
          2.5,
          HEADING_DASH_PERIOD_KM,
          HEADING_DASH_ON_KM,
        );
      }

      gl.lineWidth(1);
      gl.depthMask(true);
    } catch (error) {
      console.error("Unable to render orbit tracks", error);
    }
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    if (this.buffers) {
      gl.deleteBuffer(this.buffers.history);
      gl.deleteBuffer(this.buffers.prediction);
      gl.deleteBuffer(this.buffers.heading);
    }
    for (const program of this.programs.values()) gl.deleteProgram(program.program);
    this.programs.clear();
    this.buffers = null;
    this.map = null;
  }
}

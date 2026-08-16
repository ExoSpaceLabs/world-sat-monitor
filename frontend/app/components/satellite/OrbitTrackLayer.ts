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
import {
  STREET_SURFACE,
  THEME_CYAN,
  THEME_GREEN,
  THEME_HEADING,
  usesStreetContrast,
  type RgbaColor,
} from "../../maps/theme";

export const ORBIT_TRACK_LAYER_ID = "satellite-orbit-track";

const DEG = Math.PI / 180;
const EARTH_RADIUS_METERS = EARTH_RADIUS_KM * 1000;
const MAX_RENDER_SEGMENT_ANGLE = 1 * DEG;
const HEADING_VECTOR_LENGTH_KM = 1750;
const HEADING_VECTOR_SAMPLES = 32;

// tile x, tile y, elevation metres, cumulative physical distance km
const VERTEX_STRIDE_FLOATS = 4;
const VERTEX_STRIDE_BYTES = VERTEX_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

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
    cameraPosition: WebGLUniformLocation | null;
    clippingPlane: WebGLUniformLocation | null;
    dashOn: WebGLUniformLocation | null;
    dashPeriod: WebGLUniformLocation | null;
    depthAware: WebGLUniformLocation | null;
    fallbackMatrix: WebGLUniformLocation | null;
    mainMatrix: WebGLUniformLocation | null;
    spaceColor: WebGLUniformLocation | null;
    streetContrast: WebGLUniformLocation | null;
    surfaceColor: WebGLUniformLocation | null;
    tileMercatorCoords: WebGLUniformLocation | null;
    transition: WebGLUniformLocation | null;
  };
};

export type OrbitDebugState = {
  error: string | null;
  headingVertices: number;
  historyVertices: number;
  predictionVertices: number;
  ready: boolean;
  shaderVariant: string;
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

function toUnitVector(point: WorldPoint): [number, number, number] {
  const latitude = point.lat * DEG;
  const longitude = point.lon * DEG;
  const latitudeRadius = Math.cos(latitude);
  return [
    latitudeRadius * Math.cos(longitude),
    latitudeRadius * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

function interpolateGreatCircle(left: WorldPoint, right: WorldPoint, fraction: number): WorldPoint {
  const start = toUnitVector(left);
  const end = toUnitVector(right);
  const dot = Math.max(-1, Math.min(1,
    start[0] * end[0] + start[1] * end[1] + start[2] * end[2],
  ));
  const omega = Math.acos(dot);

  let x: number;
  let y: number;
  let z: number;
  if (omega < 1e-9) {
    x = start[0] + (end[0] - start[0]) * fraction;
    y = start[1] + (end[1] - start[1]) * fraction;
    z = start[2] + (end[2] - start[2]) * fraction;
  } else {
    const denominator = Math.sin(omega);
    const startWeight = Math.sin((1 - fraction) * omega) / denominator;
    const endWeight = Math.sin(fraction * omega) / denominator;
    x = start[0] * startWeight + end[0] * endWeight;
    y = start[1] * startWeight + end[1] * endWeight;
    z = start[2] * startWeight + end[2] * endWeight;
  }

  const length = Math.hypot(x, y, z) || 1;
  x /= length;
  y /= length;
  z /= length;
  return {
    altitude: left.altitude + (right.altitude - left.altitude) * fraction,
    lat: Math.asin(Math.max(-1, Math.min(1, z))) / DEG,
    lon: normalizeLongitude(Math.atan2(y, x) / DEG),
  };
}

function densifyForGlobe(points: WorldPoint[]) {
  if (points.length < 2) return points;

  const dense: WorldPoint[] = [{...points[0], lon: normalizeLongitude(points[0].lon)}];
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const subdivisions = Math.max(
      1,
      Math.ceil(centralAngle(left, right) / MAX_RENDER_SEGMENT_ANGLE),
    );
    for (let part = 1; part <= subdivisions; part += 1) {
      dense.push(interpolateGreatCircle(left, right, part / subdivisions));
    }
  }
  return dense;
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

  // Keep geometry in base-tile coordinates so both surface projection and the
  // depth-preserving 3D projection consume the same physical elevation metres.
  for (const strip of splitAtDateline(densifyForGlobe(points))) {
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
        coordinate.x * maplibre.EXTENT,
        coordinate.y * maplibre.EXTENT,
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
uniform highp float u_depth_aware;
uniform highp vec3 u_camera_position;
out highp float v_distance;
out highp float v_earth_overlap;

void main() {
  v_distance = a_distance;
#ifdef GLOBE
  vec3 surface_position = projectToSphere(a_pos);
  float orbit_radius = 1.0 + max(a_elevation, 0.0) / ${EARTH_RADIUS_METERS.toFixed(1)};
  vec3 point_position = surface_position * orbit_radius;
  vec3 camera_ray = point_position - u_camera_position;
  float ray_a = dot(camera_ray, camera_ray);
  float ray_b = 2.0 * dot(u_camera_position, camera_ray);
  float ray_c = dot(u_camera_position, u_camera_position) - 1.0;
  v_earth_overlap = ray_a > 0.0
    ? ray_b * ray_b - 4.0 * ray_a * ray_c
    : -1.0;
#else
  v_earth_overlap = 1.0;
#endif
  gl_Position = u_depth_aware > 0.5
    ? projectTileFor3D(a_pos, a_elevation)
    : projectTileWithElevation(a_pos, a_elevation);
}`;

  const fragmentSource = `#version 300 es
precision highp float;

in highp float v_distance;
in highp float v_earth_overlap;
uniform highp vec4 u_space_color;
uniform highp vec4 u_surface_color;
uniform highp float u_street_contrast;
uniform highp float u_dash_period;
uniform highp float u_dash_on;
out highp vec4 fragColor;

void main() {
  if (u_dash_period > 0.0 && mod(v_distance, u_dash_period) > u_dash_on) discard;
  if (u_street_contrast > 0.5) {
    fragColor = v_earth_overlap >= 0.0 ? u_surface_color : u_space_color;
  } else {
    fragColor = u_space_color;
  }
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
      cameraPosition: gl.getUniformLocation(program, "u_camera_position"),
      clippingPlane: gl.getUniformLocation(program, "u_projection_clipping_plane"),
      dashOn: gl.getUniformLocation(program, "u_dash_on"),
      dashPeriod: gl.getUniformLocation(program, "u_dash_period"),
      depthAware: gl.getUniformLocation(program, "u_depth_aware"),
      fallbackMatrix: gl.getUniformLocation(program, "u_projection_fallback_matrix"),
      mainMatrix: gl.getUniformLocation(program, "u_projection_matrix"),
      spaceColor: gl.getUniformLocation(program, "u_space_color"),
      streetContrast: gl.getUniformLocation(program, "u_street_contrast"),
      surfaceColor: gl.getUniformLocation(program, "u_surface_color"),
      tileMercatorCoords: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
      transition: gl.getUniformLocation(program, "u_projection_transition"),
    },
  };
}

function enableAttribute(
  gl: WebGL2RenderingContext,
  location: number,
  size: number,
  offsetFloats: number,
) {
  if (location < 0) return;
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(
    location,
    size,
    gl.FLOAT,
    false,
    VERTEX_STRIDE_BYTES,
    offsetFloats * Float32Array.BYTES_PER_ELEMENT,
  );
}

function drawGeometry(
  gl: WebGL2RenderingContext,
  program: ProgramState,
  buffer: WebGLBuffer,
  geometry: PathGeometry,
  spaceColor: RgbaColor,
  surfaceColor: RgbaColor,
  streetContrast: boolean,
  width: number,
  dashPeriod: number,
  dashOn: number,
) {
  if (geometry.ranges.length === 0) return;

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  enableAttribute(gl, program.attributes.position, 2, 0);
  enableAttribute(gl, program.attributes.elevation, 1, 2);
  enableAttribute(gl, program.attributes.distance, 1, 3);

  gl.uniform4f(program.uniforms.spaceColor, ...spaceColor);
  gl.uniform4f(program.uniforms.surfaceColor, ...surfaceColor);
  gl.uniform1f(program.uniforms.streetContrast, streetContrast ? 1 : 0);
  gl.uniform1f(program.uniforms.dashPeriod, dashPeriod);
  gl.uniform1f(program.uniforms.dashOn, dashOn);

  const lineWidthRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) as Float32Array;
  gl.lineWidth(Math.max(
    lineWidthRange[0] ?? 1,
    Math.min(width, lineWidthRange[1] ?? 1),
  ));

  for (const line of geometry.ranges) {
    gl.drawArrays(gl.LINE_STRIP, line.first, line.count);
  }
}

function vertexCount(geometry: PathGeometry) {
  return geometry.vertices.length / VERTEX_STRIDE_FLOATS;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class OrbitTrackLayer implements CustomLayerInterface {
  readonly id = ORBIT_TRACK_LAYER_ID;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private buffers: BufferState | null = null;
  private geometry: LayerGeometry;
  private geometryDirty = true;
  private lastDebugSignature = "";
  private map: MapLibreMap | null = null;
  private readonly programs = new Map<string, ProgramState>();

  constructor(
    private state: OrbitTrackState,
    private readonly maplibre: MapLibreModule,
    private readonly onDebugState?: (state: OrbitDebugState) => void,
  ) {
    this.geometry = buildLayerGeometry(maplibre, state);
  }

  private reportDebug(ready: boolean, shaderVariant: string, error: string | null) {
    const next: OrbitDebugState = {
      error,
      headingVertices: vertexCount(this.geometry.heading),
      historyVertices: vertexCount(this.geometry.history),
      predictionVertices: vertexCount(this.geometry.prediction),
      ready,
      shaderVariant,
    };
    const signature = JSON.stringify(next);
    if (signature === this.lastDebugSignature) return;
    this.lastDebugSignature = signature;
    this.onDebugState?.(next);
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
      const message = "Unable to allocate orbit-track buffers";
      this.reportDebug(false, "--", message);
      throw new Error(message);
    }
    this.buffers = {history, prediction, heading};
    this.geometryDirty = true;
    this.reportDebug(false, "PENDING", null);
    map.triggerRepaint();
  }

  update(state: OrbitTrackState) {
    this.state = state;
    this.geometry = buildLayerGeometry(this.maplibre, state);
    this.geometryDirty = true;
    this.lastDebugSignature = "";
    this.reportDebug(false, "PENDING", null);
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
    if (!this.state.settings.path.enabled && !this.state.settings.direction_vector_enabled) {
      this.reportDebug(true, args.shaderData.variantName, null);
      return;
    }

    try {
      this.uploadGeometry(gl);
      const program = this.getProgram(gl, args);
      const projection = args.getProjectionData({
        tileID: {wrap: 0, canonical: {x: 0, y: 0, z: 0}},
        applyGlobeMatrix: true,
      });
      const depthAware = this.state.settings.path.mode === "orbit";
      const streetContrast = this.map ? usesStreetContrast(this.map) : false;
      const historySpaceColor = streetContrast ? THEME_CYAN : THEME_GREEN;
      const predictionSpaceColor = THEME_CYAN;
      const headingSpaceColor = streetContrast ? THEME_CYAN : THEME_HEADING;
      const cameraPosition = this.map?._camera.transform.cameraPosition;

      // MapLibre configures a shared 3D depth buffer before rendering a custom
      // layer declared as `3d`. ORBIT mode leaves that depth test intact and
      // uses projectTileFor3D, so the Earth itself performs occlusion. Street
      // contrast is independent: a camera-ray/sphere test decides whether the
      // projected elevated point sits over the Earth disk or the background.
      if (depthAware) {
        gl.depthMask(false);
      } else {
        gl.disable(gl.DEPTH_TEST);
      }
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program.program);

      gl.uniformMatrix4fv(program.uniforms.fallbackMatrix, false, projection.fallbackMatrix);
      gl.uniformMatrix4fv(program.uniforms.mainMatrix, false, projection.mainMatrix);
      gl.uniform4f(program.uniforms.tileMercatorCoords, ...projection.tileMercatorCoords);
      gl.uniform4f(program.uniforms.clippingPlane, ...projection.clippingPlane);
      gl.uniform1f(program.uniforms.transition, projection.projectionTransition);
      gl.uniform1f(program.uniforms.depthAware, depthAware ? 1 : 0);
      gl.uniform3f(
        program.uniforms.cameraPosition,
        cameraPosition?.[0] ?? 0,
        cameraPosition?.[1] ?? 0,
        cameraPosition?.[2] ?? 0,
      );

      if (this.state.settings.path.enabled) {
        drawGeometry(
          gl,
          program,
          this.buffers.history,
          this.geometry.history,
          historySpaceColor,
          streetContrast ? STREET_SURFACE : historySpaceColor,
          streetContrast,
          3,
          0,
          0,
        );
        drawGeometry(
          gl,
          program,
          this.buffers.prediction,
          this.geometry.prediction,
          predictionSpaceColor,
          streetContrast ? STREET_SURFACE : predictionSpaceColor,
          streetContrast,
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
          headingSpaceColor,
          streetContrast ? STREET_SURFACE : headingSpaceColor,
          streetContrast,
          2.5,
          HEADING_DASH_PERIOD_KM,
          HEADING_DASH_ON_KM,
        );
      }

      const glError = gl.getError();
      if (glError !== gl.NO_ERROR) {
        throw new Error(`WebGL error 0x${glError.toString(16)}`);
      }
      this.reportDebug(true, args.shaderData.variantName, null);
    } catch (error) {
      const message = errorMessage(error);
      this.reportDebug(false, args.shaderData.variantName, message);
      console.error("Unable to render orbit tracks", error);
    } finally {
      gl.lineWidth(1);
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
    this.reportDebug(false, "REMOVED", null);
  }
}

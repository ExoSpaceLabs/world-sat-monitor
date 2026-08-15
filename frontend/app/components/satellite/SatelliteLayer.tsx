"use client";

import {useEffect, useRef} from "react";
import type {Map as MapLibreMap, Marker as MapLibreMarker} from "maplibre-gl";
import type {MapSession} from "../../domain/types";
import {estimateRenderedGlobeRadius} from "../globe/projection";
import {
  EARTH_RADIUS_KM,
  headingEndpoint,
  isSatelliteOccluded,
  type GlobeVector,
  type Satellite,
  type SatelliteTrackPoint,
} from "../../domain/satellite";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const HEADING_VECTOR_LENGTH_KM = 1750;
const HEADING_VECTOR_SAMPLES = 20;
const OVERLAY_REDRAW_INTERVAL_MS = 33;

type MarkerElements = {
  heading: HTMLElement;
  name: HTMLElement;
  node: HTMLButtonElement;
  visual: HTMLElement;
};

type OrbitOverlayElements = {
  svg: SVGSVGElement;
  history: SVGPathElement;
  prediction: SVGPathElement;
  heading: SVGPathElement;
};

type SurfacePoint = {
  lat: number;
  lon: number;
};

function createMarkerNode(onSelect: () => void): MarkerElements {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "satellite-marker";

  const visual = document.createElement("span");
  visual.className = "satellite-visual";
  const pulse = document.createElement("span");
  pulse.className = "satellite-pulse";
  const core = document.createElement("span");
  core.className = "satellite-core";
  const label = document.createElement("span");
  label.className = "satellite-label";
  const name = document.createElement("b");
  const heading = document.createElement("small");
  label.append(name, heading);
  visual.append(pulse, core, label);
  node.append(visual);
  node.addEventListener("click", onSelect);
  return {heading, name, node, visual};
}

function createOrbitOverlay(map: MapLibreMap): OrbitOverlayElements {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.classList.add("orbit-vector-overlay");
  svg.setAttribute("aria-hidden", "true");

  const history = document.createElementNS(SVG_NAMESPACE, "path");
  history.classList.add("orbit-history-path");
  const prediction = document.createElementNS(SVG_NAMESPACE, "path");
  prediction.classList.add("orbit-prediction-path");
  const heading = document.createElementNS(SVG_NAMESPACE, "path");
  heading.classList.add("orbit-heading-path");

  svg.append(history, prediction, heading);
  map.getContainer().append(svg);
  return {svg, history, prediction, heading};
}

function normalizeLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function getGlobeCameraPosition(map: MapLibreMap): GlobeVector | null {
  const transform = map._camera.transform;
  if (!transform.getClippingPlane()) return null;
  const camera = transform.cameraPosition;
  return [camera[0], camera[1], camera[2]];
}

function isSurfacePointVisible(point: SurfacePoint, cameraPosition: GlobeVector | null) {
  if (!cameraPosition) return true;
  return !isSatelliteOccluded(
    {lat: point.lat, lon: point.lon, altitude: 0},
    cameraPosition,
  );
}

function pointsToSvgPath(
  map: MapLibreMap,
  points: SurfacePoint[],
  cameraPosition: GlobeVector | null,
) {
  if (points.length < 2) return "";

  const container = map.getContainer();
  const jumpThreshold = Math.max(container.clientWidth, container.clientHeight) * 0.55;
  let path = "";
  let previous: SurfacePoint | null = null;
  let previousProjected: {x: number; y: number} | null = null;
  let penDown = false;

  for (const point of points) {
    const longitude = normalizeLongitude(point.lon);
    const normalized = {lat: point.lat, lon: longitude};
    const visible = isSurfacePointVisible(normalized, cameraPosition);
    if (!visible) {
      previous = normalized;
      previousProjected = null;
      penDown = false;
      continue;
    }

    const projected = map.project([longitude, point.lat]);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      previous = normalized;
      previousProjected = null;
      penDown = false;
      continue;
    }

    const crossesDateline = previous !== null
      && Math.abs(normalized.lon - previous.lon) > 180;
    const projectionJump = previousProjected !== null
      && Math.hypot(
        projected.x - previousProjected.x,
        projected.y - previousProjected.y,
      ) > jumpThreshold;

    if (!penDown || crossesDateline || projectionJump) {
      path += `M${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
      penDown = true;
    } else {
      path += `L${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
    }

    previous = normalized;
    previousProjected = projected;
  }

  return path;
}

function trackSegment(
  track: SatelliteTrackPoint[],
  segment: SatelliteTrackPoint["segment"],
  satellite: Satellite,
): SurfacePoint[] {
  const points = track
    .filter((point) => point.segment === segment)
    .map((point) => ({lat: point.lat, lon: point.lon}));
  const current = {lat: satellite.lat, lon: satellite.lon};
  return segment === "history" ? [...points, current] : [current, ...points];
}

function headingVector(satellite: Satellite): SurfacePoint[] {
  const points: SurfacePoint[] = [];
  for (let sample = 0; sample <= HEADING_VECTOR_SAMPLES; sample += 1) {
    const distance = HEADING_VECTOR_LENGTH_KM * sample / HEADING_VECTOR_SAMPLES;
    if (distance === 0) {
      points.push({lat: satellite.lat, lon: satellite.lon});
      continue;
    }
    const [lon, lat] = headingEndpoint(
      satellite.lon,
      satellite.lat,
      satellite.heading,
      distance,
    );
    points.push({lat, lon});
  }
  return points;
}

function renderOrbitOverlay(
  map: MapLibreMap,
  overlay: OrbitOverlayElements,
  track: SatelliteTrackPoint[],
  satellite: Satellite,
) {
  const container = map.getContainer();
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return;

  overlay.svg.setAttribute(
    "viewBox",
    `0 0 ${container.clientWidth} ${container.clientHeight}`,
  );

  const cameraPosition = getGlobeCameraPosition(map);
  overlay.history.setAttribute(
    "d",
    pointsToSvgPath(
      map,
      trackSegment(track, "history", satellite),
      cameraPosition,
    ),
  );
  overlay.prediction.setAttribute(
    "d",
    pointsToSvgPath(
      map,
      trackSegment(track, "prediction", satellite),
      cameraPosition,
    ),
  );
  overlay.heading.setAttribute(
    "d",
    pointsToSvgPath(map, headingVector(satellite), cameraPosition),
  );
}

function updateMarkerPresentation(
  map: MapLibreMap,
  elements: MarkerElements,
  satellite: Satellite,
) {
  const earthCenter = map.project(map.getCenter());
  const surfacePoint = map.project([satellite.lon, satellite.lat]);
  const radialX = surfacePoint.x - earthCenter.x;
  const radialY = surfacePoint.y - earthCenter.y;
  const radialDistance = Math.hypot(radialX, radialY);
  const globeRadius = estimateRenderedGlobeRadius(map);
  const altitudeRatio = Math.max(0, satellite.altitude) / EARTH_RADIUS_KM;
  const surfaceRadius = Math.min(radialDistance, globeRadius);
  const altitudePixels = surfaceRadius * altitudeRatio;
  const inverseDistance = radialDistance > 1e-6 ? 1 / radialDistance : 0;
  elements.visual.style.transform = `translate3d(${(radialX * inverseDistance * altitudePixels).toFixed(2)}px,${(radialY * inverseDistance * altitudePixels).toFixed(2)}px,0)`;

  const cameraPosition = getGlobeCameraPosition(map);
  const occluded = cameraPosition
    ? isSatelliteOccluded(satellite, cameraPosition)
    : false;
  elements.node.classList.toggle("occluded", occluded);
  elements.node.dataset.visibility = occluded ? "occluded" : "visible";
}

type SatelliteLayerProps = {
  mapSession: MapSession | null;
  satellite: Satellite;
  track: SatelliteTrackPoint[];
  selected: boolean;
  onSelect: () => void;
};

export function SatelliteLayer({
  mapSession,
  satellite,
  track,
  selected,
  onSelect,
}: SatelliteLayerProps) {
  const map = mapSession?.map;
  const Marker = mapSession?.maplibre.Marker;
  const elementsRef = useRef<MarkerElements | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const overlayRef = useRef<OrbitOverlayElements | null>(null);
  const latestSatelliteRef = useRef(satellite);
  const latestTrackRef = useRef(track);

  useEffect(() => {
    latestSatelliteRef.current = satellite;
    map?.triggerRepaint();
  }, [map, satellite]);

  useEffect(() => {
    latestTrackRef.current = track;
    map?.triggerRepaint();
  }, [map, track]);

  useEffect(() => {
    if (!map || !Marker) return;
    const elements = createMarkerNode(onSelect);
    const marker = new Marker({
      element: elements.node,
      anchor: "center",
      opacity: 1,
      opacityWhenCovered: 1,
      subpixelPositioning: true,
    })
      .setLngLat([latestSatelliteRef.current.lon, latestSatelliteRef.current.lat])
      .addTo(map);
    elementsRef.current = elements;
    markerRef.current = marker;

    const update = () => updateMarkerPresentation(map, elements, latestSatelliteRef.current);
    map.on("render", update);
    update();

    return () => {
      map.off("render", update);
      marker.remove();
      if (elementsRef.current === elements) elementsRef.current = null;
      if (markerRef.current === marker) markerRef.current = null;
    };
  }, [Marker, map, onSelect]);

  useEffect(() => {
    const elements = elementsRef.current;
    const marker = markerRef.current;
    if (!map || !elements || !marker) return;
    elements.name.textContent = satellite.name;
    elements.heading.textContent = `${satellite.heading.toFixed(1)}° HEADING · ${satellite.altitude.toFixed(1)} KM`;
    elements.node.classList.toggle("selected", selected);
    elements.node.setAttribute("aria-label", `Select and follow ${satellite.name}`);
    marker.setLngLat([satellite.lon, satellite.lat]);
    updateMarkerPresentation(map, elements, satellite);
  }, [map, satellite, selected]);

  useEffect(() => {
    if (!map) return;
    const overlay = createOrbitOverlay(map);
    overlayRef.current = overlay;
    let lastRender = 0;

    const render = () => {
      const timestamp = performance.now();
      if (timestamp - lastRender < OVERLAY_REDRAW_INTERVAL_MS) return;
      lastRender = timestamp;
      renderOrbitOverlay(
        map,
        overlay,
        latestTrackRef.current,
        latestSatelliteRef.current,
      );
    };

    map.on("render", render);
    render();
    return () => {
      map.off("render", render);
      overlay.svg.remove();
      if (overlayRef.current === overlay) overlayRef.current = null;
    };
  }, [map]);

  return null;
}

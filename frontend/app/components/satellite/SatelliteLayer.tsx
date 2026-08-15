"use client";

import {useEffect, useRef} from "react";
import type {Map as MapLibreMap, Marker as MapLibreMarker} from "maplibre-gl";
import {DEFAULT_APP_SETTINGS, type OrbitDisplaySettings} from "../../domain/settings";
import type {MapSession} from "../../domain/types";
import {getAppSettings} from "../../services/worldsat-api";
import {estimateRenderedGlobeRadius} from "../globe/projection";
import {
  EARTH_RADIUS_KM,
  isSatelliteOccluded,
  type GlobeVector,
  type Satellite,
  type SatelliteTrackPoint,
} from "../../domain/satellite";
import {ORBIT_DISPLAY_CHANGE_EVENT} from "./OrbitSettingsPanel";
import {OrbitTrackLayer, ORBIT_TRACK_LAYER_ID} from "./OrbitTrackLayer";

type MarkerElements = {
  heading: HTMLElement;
  name: HTMLElement;
  node: HTMLButtonElement;
  visual: HTMLElement;
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

function getGlobeCameraPosition(map: MapLibreMap): GlobeVector | null {
  const transform = map._camera.transform;
  if (!transform.getClippingPlane()) return null;
  const camera = transform.cameraPosition;
  return [camera[0], camera[1], camera[2]];
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
  const trackLayerRef = useRef<OrbitTrackLayer | null>(null);
  const latestSatelliteRef = useRef(satellite);
  const latestTrackRef = useRef(track);
  const orbitSettingsRef = useRef<OrbitDisplaySettings>(DEFAULT_APP_SETTINGS.orbit);

  useEffect(() => {
    latestSatelliteRef.current = satellite;
    trackLayerRef.current?.update({
      satellite,
      settings: orbitSettingsRef.current,
      track: latestTrackRef.current,
    });
    map?.triggerRepaint();
  }, [map, satellite]);

  useEffect(() => {
    latestTrackRef.current = track;
    trackLayerRef.current?.update({
      satellite: latestSatelliteRef.current,
      settings: orbitSettingsRef.current,
      track,
    });
    map?.triggerRepaint();
  }, [map, track]);

  useEffect(() => {
    let cancelled = false;
    void getAppSettings().then((settings) => {
      if (cancelled) return;
      orbitSettingsRef.current = settings.orbit;
      trackLayerRef.current?.update({
        satellite: latestSatelliteRef.current,
        settings: settings.orbit,
        track: latestTrackRef.current,
      });
    }).catch(() => undefined);

    const handleDisplayChange = (event: Event) => {
      const custom = event as CustomEvent<OrbitDisplaySettings>;
      orbitSettingsRef.current = custom.detail;
      trackLayerRef.current?.update({
        satellite: latestSatelliteRef.current,
        settings: custom.detail,
        track: latestTrackRef.current,
      });
    };
    window.addEventListener(ORBIT_DISPLAY_CHANGE_EVENT, handleDisplayChange);
    return () => {
      cancelled = true;
      window.removeEventListener(ORBIT_DISPLAY_CHANGE_EVENT, handleDisplayChange);
    };
  }, []);

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
    if (!mapSession) return;
    const map = mapSession.map;
    const layer = new OrbitTrackLayer(
      {
        satellite: latestSatelliteRef.current,
        settings: orbitSettingsRef.current,
        track: latestTrackRef.current,
      },
      mapSession.maplibre,
    );
    trackLayerRef.current = layer;

    const install = () => {
      try {
        if (map.getLayer(ORBIT_TRACK_LAYER_ID)) map.removeLayer(ORBIT_TRACK_LAYER_ID);
        map.addLayer(layer);
      } catch (error) {
        console.error("Unable to install orbit-track layer", error);
      }
    };

    if (map.isStyleLoaded()) install();
    else map.once("style.load", install);

    return () => {
      map.off("style.load", install);
      if (map.getLayer(ORBIT_TRACK_LAYER_ID)) map.removeLayer(ORBIT_TRACK_LAYER_ID);
      if (trackLayerRef.current === layer) trackLayerRef.current = null;
    };
    // styleRevision in MapSession intentionally recreates the custom layer
    // after a basemap replacement because MapLibre removes custom layers with
    // the old style.
  }, [mapSession]);

  return null;
}

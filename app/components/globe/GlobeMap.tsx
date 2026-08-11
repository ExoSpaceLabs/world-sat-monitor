"use client";

import {useEffect, useRef} from "react";
import type {Map as MapLibreMap} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  AUTO_ROTATION_MAX_ZOOM,
  INITIAL_VIEW,
  ROTATION_DEGREES_PER_SECOND,
  ROTATION_RESUME_DELAY_MS,
  shouldAutoRotate,
  type SceneOrientation,
} from "../../domain/scene";
import type {Basemap, MapSession, MapState} from "../../domain/types";
import type {Satellite} from "../../domain/satellite";
import {fallbackStyle, loadBasemapStyle} from "../../maps/styles";

type GlobeMapProps = {
  basemap: Basemap;
  followSatellite: boolean;
  resetKey: number;
  satellite: Satellite;
  onMapSession: (session: MapSession | null) => void;
  onMapState: (state: MapState) => void;
  onOrientationChange: (orientation: SceneOrientation) => void;
  onRotationChange: (active: boolean, reason: "active" | "follow" | "interaction" | "zoom") => void;
};

function makeOrientation(map: MapLibreMap): SceneOrientation {
  const center = map.getCenter();
  return {
    longitude: center.lng,
    latitude: center.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function makeAtmosphereTransparent(map: MapLibreMap) {
  map.setProjection({type: "globe"});
  map.setSky({
    "sky-color": "rgba(0, 0, 0, 0)",
    "horizon-color": "rgba(0, 0, 0, 0)",
    "fog-color": "rgba(0, 0, 0, 0)",
    "fog-ground-blend": 0,
    "horizon-fog-blend": 0,
    "sky-horizon-blend": 0,
    "atmosphere-blend": 0,
  });
}

export function GlobeMap({
  basemap,
  followSatellite,
  resetKey,
  satellite,
  onMapSession,
  onMapState,
  onOrientationChange,
  onRotationChange,
}: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<MapSession["maplibre"] | null>(null);
  const styleRequestRef = useRef(0);
  const styleRevisionRef = useRef(0);
  const basemapRef = useRef(basemap);
  const followRef = useRef(followSatellite);
  const callbacksRef = useRef({onMapSession, onMapState, onOrientationChange, onRotationChange});

  useEffect(() => { followRef.current = followSatellite; }, [followSatellite]);
  useEffect(() => {
    callbacksRef.current = {onMapSession, onMapState, onOrientationChange, onRotationChange};
  }, [onMapSession, onMapState, onOrientationChange, onRotationChange]);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    let animationFrame = 0;
    let lastFrame = performance.now();
    let lastOrientationReport = 0;
    let rotationPausedUntil = 0;
    let lastRotationReason: "active" | "follow" | "interaction" | "zoom" | null = null;

    const reportOrientation = (force = false) => {
      if (!map) return;
      const timestamp = performance.now();
      if (!force && timestamp - lastOrientationReport < 90) return;
      lastOrientationReport = timestamp;
      callbacksRef.current.onOrientationChange(makeOrientation(map));
    };

    void Promise.all([
      import("maplibre-gl"),
      loadBasemapStyle(basemapRef.current).catch(() => fallbackStyle()),
    ]).then(([maplibre, style]) => {
      if (disposed || !containerRef.current) return;
      maplibreRef.current = maplibre;
      map = new maplibre.Map({
        container: containerRef.current,
        center: INITIAL_VIEW.center,
        zoom: INITIAL_VIEW.zoom,
        bearing: INITIAL_VIEW.bearing,
        pitch: INITIAL_VIEW.pitch,
        minZoom: 0,
        maxZoom: 18,
        attributionControl: false,
        renderWorldCopies: false,
        canvasContextAttributes: {alpha: true},
        style,
      });
      mapRef.current = map;

      map.on("style.load", () => {
        if (!map || !maplibreRef.current) return;
        makeAtmosphereTransparent(map);
        styleRevisionRef.current += 1;
        callbacksRef.current.onMapSession({
          map,
          maplibre: maplibreRef.current,
          styleRevision: styleRevisionRef.current,
        });
        callbacksRef.current.onMapState("ready");
      });
      map.on("error", () => callbacksRef.current.onMapState("fallback"));
      map.on("move", () => reportOrientation());
      map.once("load", () => reportOrientation(true));

      const pauseRotation = () => {
        rotationPausedUntil = performance.now() + ROTATION_RESUME_DELAY_MS;
      };
      const canvas = map.getCanvasContainer();
      canvas.addEventListener("pointerdown", pauseRotation);
      canvas.addEventListener("wheel", pauseRotation, {passive: true});
      canvas.addEventListener("touchstart", pauseRotation, {passive: true});

      const rotate = (timestamp: number) => {
        if (!map || disposed) return;
        const elapsedSeconds = Math.min((timestamp - lastFrame) / 1000, 0.1);
        lastFrame = timestamp;
        const interactionPaused = timestamp < rotationPausedUntil;
        const zoomPaused = map.getZoom() >= AUTO_ROTATION_MAX_ZOOM;
        const active = shouldAutoRotate({
          followSatellite: followRef.current,
          isInteracting: interactionPaused,
          isMoving: map.isMoving(),
          zoom: map.getZoom(),
        });
        const reason = active
          ? "active"
          : followRef.current
            ? "follow"
            : zoomPaused
              ? "zoom"
              : "interaction";

        if (reason !== lastRotationReason) {
          lastRotationReason = reason;
          callbacksRef.current.onRotationChange(active, reason);
        }
        if (active) {
          const center = map.getCenter();
          map.jumpTo({center: [center.lng + ROTATION_DEGREES_PER_SECOND * elapsedSeconds, center.lat]});
        }
        animationFrame = requestAnimationFrame(rotate);
      };
      animationFrame = requestAnimationFrame(rotate);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      callbacksRef.current.onMapSession(null);
      map?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemapRef.current === basemap) return;
    basemapRef.current = basemap;
    const requestId = ++styleRequestRef.current;
    onMapState("loading");
    void loadBasemapStyle(basemap)
      .then((style) => {
        if (requestId === styleRequestRef.current && mapRef.current) mapRef.current.setStyle(style);
      })
      .catch(() => {
        if (requestId === styleRequestRef.current && mapRef.current) {
          mapRef.current.setStyle(fallbackStyle());
          onMapState("fallback");
        }
      });
  }, [basemap, onMapState]);

  useEffect(() => {
    if (!followSatellite) return;
    const map = mapRef.current;
    map?.easeTo({
      center: [satellite.lon, satellite.lat],
      zoom: Math.max(map.getZoom(), 2.4),
      duration: 900,
    });
  }, [followSatellite, satellite.lat, satellite.lon]);

  useEffect(() => {
    if (resetKey === 0) return;
    mapRef.current?.easeTo({...INITIAL_VIEW, duration: 850});
  }, [resetKey]);

  return (
    <div
      ref={containerRef}
      className="globe-map"
      aria-label="Interactive rotating 3D Earth map"
      data-layer="globe-map"
    />
  );
}

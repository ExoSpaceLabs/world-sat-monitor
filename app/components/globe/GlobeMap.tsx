"use client";

import {useEffect, useRef} from "react";
import type {ReactNode} from "react";
import type {Map as MapLibreMap} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  INITIAL_VIEW,
  ROTATION_DEGREES_PER_SECOND,
  ROTATION_RESUME_DELAY_MS,
  inertialCameraLongitude,
  shouldAutoRotate,
  shouldLockCameraToEarth,
  type SceneOrientation,
} from "../../domain/scene";
import type {Basemap, MapSession, MapState} from "../../domain/types";
import type {Satellite} from "../../domain/satellite";
import {fallbackStyle, loadBasemapStyle} from "../../maps/styles";

type GlobeMapProps = {
  basemap: Basemap;
  children?: ReactNode;
  followSatellite: boolean;
  resetKey: number;
  satellite: Satellite;
  timeResetKey: number;
  timeScale: number;
  onMapSession: (session: MapSession | null) => void;
  onMapState: (state: MapState) => void;
  onOrientationChange: (orientation: SceneOrientation) => void;
  onRotationChange: (active: boolean, reason: "active" | "follow" | "interaction" | "zoom") => void;
};

const ORIENTATION_REPORT_INTERVAL_MS = 16;

function makeOrientation(
  map: MapLibreMap,
  earthRotationDegrees: number,
  cameraLockedToEarth: boolean,
): SceneOrientation {
  const center = map.getCenter();
  return {
    longitude: center.lng,
    inertialLongitude: inertialCameraLongitude(center.lng, earthRotationDegrees),
    earthRotationDegrees,
    cameraLockedToEarth,
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
  children,
  followSatellite,
  resetKey,
  satellite,
  timeResetKey,
  timeScale,
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
  const timeScaleRef = useRef(timeScale);
  const earthRotationRef = useRef(0);
  const appliedMapRotationRef = useRef(0);
  const callbacksRef = useRef({onMapSession, onMapState, onOrientationChange, onRotationChange});

  useEffect(() => { followRef.current = followSatellite; }, [followSatellite]);
  useEffect(() => { timeScaleRef.current = timeScale; }, [timeScale]);
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
    let cameraLockedToEarth = false;
    let lastRotationReason: "active" | "follow" | "interaction" | "zoom" | null = null;

    const reportOrientation = (force = false) => {
      if (!map) return;
      const timestamp = performance.now();
      if (!force && timestamp - lastOrientationReport < ORIENTATION_REPORT_INTERVAL_MS) return;
      lastOrientationReport = timestamp;
      callbacksRef.current.onOrientationChange(
        makeOrientation(map, earthRotationRef.current, cameraLockedToEarth),
      );
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
        const mapMoving = map.isMoving();
        cameraLockedToEarth = shouldLockCameraToEarth({
          followSatellite: followRef.current,
          zoom: map.getZoom(),
        });
        const earthMovesUnderCamera = shouldAutoRotate({
          followSatellite: followRef.current,
          isInteracting: interactionPaused,
          isMoving: mapMoving,
          zoom: map.getZoom(),
        });
        const rotationRunning = !interactionPaused && !mapMoving;
        const reason = rotationRunning
          ? followRef.current
            ? "follow"
            : cameraLockedToEarth
              ? "zoom"
              : "active"
          : "interaction";

        if (reason !== lastRotationReason) {
          lastRotationReason = reason;
          callbacksRef.current.onRotationChange(rotationRunning, reason);
        }

        if (rotationRunning) {
          const rotationDelta = ROTATION_DEGREES_PER_SECOND
            * elapsedSeconds
            * Math.max(0, timeScaleRef.current);
          earthRotationRef.current += rotationDelta;
          if (earthMovesUnderCamera) {
            const center = map.getCenter();
            map.jumpTo({center: [center.lng - rotationDelta, center.lat]});
            appliedMapRotationRef.current += rotationDelta;
          }
          reportOrientation();
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

  useEffect(() => {
    if (timeResetKey === 0) return;
    const map = mapRef.current;
    if (map && appliedMapRotationRef.current !== 0) {
      const center = map.getCenter();
      map.jumpTo({
        center: [center.lng + appliedMapRotationRef.current, center.lat],
      });
    }
    earthRotationRef.current = 0;
    appliedMapRotationRef.current = 0;
    if (map) {
      const locked = shouldLockCameraToEarth({followSatellite: followRef.current, zoom: map.getZoom()});
      callbacksRef.current.onOrientationChange(makeOrientation(map, 0, locked));
    }
  }, [timeResetKey]);

  return (
    <div
      className="globe-map"
      aria-label="Interactive rotating 3D Earth map"
      data-layer="globe-map"
    >
      <div ref={containerRef} className="globe-map-host"/>
      {children}
    </div>
  );
}

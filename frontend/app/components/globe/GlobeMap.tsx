"use client";

import {useEffect, useRef} from "react";
import type {ReactNode} from "react";
import type {Map as MapLibreMap} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  INITIAL_VIEW,
  ROTATION_DEGREES_PER_SECOND,
  inertialCameraLongitude,
  shouldAutoRotate,
  shouldLockCameraToEarth,
  type SceneOrientation,
} from "../../domain/scene";
import type {Basemap, MapSession, MapState} from "../../domain/types";
import type {Satellite} from "../../domain/satellite";
import {
  THEMED_LAND_LAYER_ID,
  THEMED_WATER_LAYER_ID,
  fallbackStyle,
  loadBasemapStyle,
} from "../../maps/styles";

type RotationReason = "active" | "follow" | "zoom";

type GlobeMapProps = {
  basemap: Basemap;
  children?: ReactNode;
  followSatellite: boolean;
  resetKey: number;
  satellite: Satellite;
  themeLandColor: string;
  themeWaterColor: string;
  timeResetKey: number;
  timeScale: number;
  onMapSession: (session: MapSession | null) => void;
  onMapState: (state: MapState) => void;
  onOrientationChange: (orientation: SceneOrientation) => void;
  onRotationChange: (active: boolean, reason: RotationReason) => void;
};

const ORIENTATION_REPORT_INTERVAL_MS = 33;
const WHEEL_INTERACTION_RELEASE_MS = 120;

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
  themeLandColor,
  themeWaterColor,
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
  const themeLandColorRef = useRef(themeLandColor);
  const themeWaterColorRef = useRef(themeWaterColor);
  const fallbackActiveRef = useRef(false);
  const followRef = useRef(followSatellite);
  const timeScaleRef = useRef(timeScale);
  const earthRotationRef = useRef(0);
  const appliedMapRotationRef = useRef(0);
  const pendingMapRotationRef = useRef(0);
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
    let cameraLockedToEarth = false;
    let lastRotationReason: RotationReason | null = null;
    let userInteracting = false;
    let wheelReleaseTimer = 0;
    let cleanupInteraction: (() => void) | null = null;

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
      loadBasemapStyle(basemapRef.current, {
        land: themeLandColorRef.current,
        water: themeWaterColorRef.current,
      }).catch(() => {
        fallbackActiveRef.current = true;
        return fallbackStyle();
      }),
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
        callbacksRef.current.onMapState(fallbackActiveRef.current ? "fallback" : "ready");
      });
      map.on("error", () => {
        callbacksRef.current.onMapState("fallback");
        if (!map || fallbackActiveRef.current || basemapRef.current !== "dark") return;
        fallbackActiveRef.current = true;
        map.setStyle(fallbackStyle());
      });
      map.on("move", () => reportOrientation());
      map.once("load", () => reportOrientation(true));

      const canvas = map.getCanvasContainer();
      const beginPointerInteraction = () => {
        userInteracting = true;
      };
      const endPointerInteraction = () => {
        userInteracting = false;
      };
      const beginWheelInteraction = () => {
        userInteracting = true;
        window.clearTimeout(wheelReleaseTimer);
        wheelReleaseTimer = window.setTimeout(() => {
          userInteracting = false;
        }, WHEEL_INTERACTION_RELEASE_MS);
      };
      canvas.addEventListener("pointerdown", beginPointerInteraction);
      canvas.addEventListener("wheel", beginWheelInteraction, {passive: true});
      window.addEventListener("pointerup", endPointerInteraction);
      window.addEventListener("pointercancel", endPointerInteraction);
      cleanupInteraction = () => {
        canvas.removeEventListener("pointerdown", beginPointerInteraction);
        canvas.removeEventListener("wheel", beginWheelInteraction);
        window.removeEventListener("pointerup", endPointerInteraction);
        window.removeEventListener("pointercancel", endPointerInteraction);
        window.clearTimeout(wheelReleaseTimer);
      };

      const rotate = (timestamp: number) => {
        if (!map || disposed) return;
        const elapsedSeconds = Math.min((timestamp - lastFrame) / 1000, 0.1);
        lastFrame = timestamp;
        cameraLockedToEarth = shouldLockCameraToEarth({
          followSatellite: followRef.current,
          zoom: map.getZoom(),
        });
        const earthMovesUnderCamera = shouldAutoRotate({
          followSatellite: followRef.current,
          zoom: map.getZoom(),
        });
        const reason: RotationReason = followRef.current
          ? "follow"
          : cameraLockedToEarth
            ? "zoom"
            : "active";

        if (reason !== lastRotationReason) {
          lastRotationReason = reason;
          callbacksRef.current.onRotationChange(true, reason);
        }

        const rotationDelta = ROTATION_DEGREES_PER_SECOND
          * elapsedSeconds
          * Math.max(0, timeScaleRef.current);
        earthRotationRef.current += rotationDelta;

        if (earthMovesUnderCamera && rotationDelta !== 0) {
          if (userInteracting || map.isMoving()) {
            pendingMapRotationRef.current += rotationDelta;
          } else {
            const visualRotation = rotationDelta + pendingMapRotationRef.current;
            pendingMapRotationRef.current = 0;
            const center = map.getCenter();
            map.jumpTo({center: [center.lng - visualRotation, center.lat]});
            appliedMapRotationRef.current += visualRotation;
          }
        } else {
          pendingMapRotationRef.current = 0;
        }

        reportOrientation();
        animationFrame = requestAnimationFrame(rotate);
      };
      animationFrame = requestAnimationFrame(rotate);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      cleanupInteraction?.();
      callbacksRef.current.onMapSession(null);
      map?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const basemapChanged = basemapRef.current !== basemap;
    const landChanged = themeLandColorRef.current !== themeLandColor;
    const waterChanged = themeWaterColorRef.current !== themeWaterColor;
    const themeChanged = basemap === "dark" && (landChanged || waterChanged);
    if (!map || (!basemapChanged && !themeChanged)) return;

    if (!basemapChanged && themeChanged) {
      const landLayerReady = Boolean(map.getLayer(THEMED_LAND_LAYER_ID));
      const waterLayerReady = Boolean(map.getLayer(THEMED_WATER_LAYER_ID));
      if (landLayerReady && waterLayerReady) {
        if (waterChanged) {
          map.setPaintProperty(THEMED_WATER_LAYER_ID, "background-color", themeWaterColor);
        }
        if (landChanged) {
          map.setPaintProperty(THEMED_LAND_LAYER_ID, "fill-color", themeLandColor);
          map.setPaintProperty(THEMED_LAND_LAYER_ID, "fill-outline-color", themeLandColor);
        }
        themeLandColorRef.current = themeLandColor;
        themeWaterColorRef.current = themeWaterColor;
        map.triggerRepaint();
        return;
      }
    }

    basemapRef.current = basemap;
    themeLandColorRef.current = themeLandColor;
    themeWaterColorRef.current = themeWaterColor;
    fallbackActiveRef.current = false;
    const requestId = ++styleRequestRef.current;
    onMapState("loading");
    void loadBasemapStyle(basemap, {land: themeLandColor, water: themeWaterColor})
      .then((style) => {
        if (requestId === styleRequestRef.current && mapRef.current) mapRef.current.setStyle(style);
      })
      .catch(() => {
        if (requestId === styleRequestRef.current && mapRef.current) {
          fallbackActiveRef.current = true;
          mapRef.current.setStyle(fallbackStyle());
          onMapState("fallback");
        }
      });
  }, [basemap, onMapState, themeLandColor, themeWaterColor]);

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
    pendingMapRotationRef.current = 0;
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

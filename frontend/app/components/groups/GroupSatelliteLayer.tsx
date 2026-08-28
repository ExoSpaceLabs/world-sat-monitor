"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import type {MapMouseEvent} from "maplibre-gl";
import type {GroupPosition, GlobeVector, Satellite} from "../../domain/satellite";
import {headingEndpoint, isSatelliteOccluded} from "../../domain/satellite";
import type {GroupOrbitDisplaySettings} from "../../domain/settings";
import type {MapSession} from "../../domain/types";
import {projectSatelliteScreenPosition} from "../satellite/satelliteProjection";
import {buildGroupRenderPoints, type GroupRenderPoint} from "./group-features";

const GROUP_VECTOR_LENGTH_KM = 650;
const HIT_RADIUS_PX = 9;

type ProjectedPoint = GroupRenderPoint & {x: number; y: number};
type HoverState = {name: string; x: number; y: number} | null;

type GroupSatelliteLayerProps = {
  mapSession: MapSession | null;
  positions: GroupPosition[];
  selectedNoradId: string;
  settings: GroupOrbitDisplaySettings;
  onSelect: (noradId: string) => void;
};

function getGlobeCameraPosition(map: MapSession["map"]): GlobeVector | null {
  const transform = map._camera.transform;
  if (!transform.getClippingPlane()) return null;
  const camera = transform.cameraPosition;
  return [camera[0], camera[1], camera[2]];
}

function asSatellite(point: GroupRenderPoint, placement: GroupOrbitDisplaySettings["marker_placement"]): Satellite {
  return {
    name: point.name,
    norad: point.norad_id,
    lat: point.lat,
    lon: point.lon,
    altitude: placement === "orbit" ? point.altitude : 0,
    heading: point.heading ?? 0,
  };
}

function nearestPoint(points: ProjectedPoint[], x: number, y: number) {
  let nearest: ProjectedPoint | null = null;
  let nearestDistance = HIT_RADIUS_PX * HIT_RADIUS_PX;
  for (const point of points) {
    const dx = point.x - x;
    const dy = point.y - y;
    const distance = dx * dx + dy * dy;
    if (distance <= nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function GroupSatelliteLayer({
  mapSession,
  positions,
  selectedNoradId,
  settings,
  onSelect,
}: GroupSatelliteLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectedRef = useRef<ProjectedPoint[]>([]);
  const renderPoints = useMemo(
    () => buildGroupRenderPoints(positions, selectedNoradId),
    [positions, selectedNoradId],
  );
  const renderPointsRef = useRef(renderPoints);
  const settingsRef = useRef(settings);
  const [hover, setHover] = useState<HoverState>(null);

  useEffect(() => {
    renderPointsRef.current = renderPoints;
    mapSession?.map.triggerRepaint();
  }, [mapSession, renderPoints]);

  useEffect(() => {
    settingsRef.current = settings;
    mapSession?.map.triggerRepaint();
  }, [mapSession, settings]);

  useEffect(() => {
    if (!mapSession) return;
    const {map, maplibre} = mapSession;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const width = map.getCanvas().clientWidth;
      const height = map.getCanvas().clientHeight;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";

      const projected: ProjectedPoint[] = [];
      const camera = getGlobeCameraPosition(map);
      const currentSettings = settingsRef.current;
      const markerRadius = Math.max(1.8, Math.min(4.8, 1.8 + Math.max(0, map.getZoom()) * 0.55));

      for (const point of renderPointsRef.current) {
        const satellite = asSatellite(point, currentSettings.marker_placement);
        if (camera && isSatelliteOccluded(satellite, camera)) continue;
        const screen = projectSatelliteScreenPosition(map, maplibre, satellite);
        if (!screen || screen.x < -20 || screen.x > width + 20 || screen.y < -20 || screen.y > height + 20) continue;

        projected.push({...point, x: screen.x, y: screen.y});

        if (currentSettings.direction_vector_enabled && point.heading !== null) {
          const [endLon, endLat] = headingEndpoint(point.lon, point.lat, point.heading, GROUP_VECTOR_LENGTH_KM);
          const endpoint = projectSatelliteScreenPosition(map, maplibre, {
            ...satellite,
            lon: endLon,
            lat: endLat,
          });
          if (endpoint) {
            context.beginPath();
            context.setLineDash([4, 4]);
            context.lineWidth = 1;
            context.strokeStyle = point.active ? "rgba(87,228,160,.56)" : "rgba(112,145,157,.34)";
            context.moveTo(screen.x, screen.y);
            context.lineTo(endpoint.x, endpoint.y);
            context.stroke();
          }
        }

        context.setLineDash([]);
        context.beginPath();
        context.arc(screen.x, screen.y, markerRadius, 0, Math.PI * 2);
        context.fillStyle = point.active ? "rgba(98,246,200,.92)" : "rgba(102,130,139,.64)";
        context.fill();
        context.lineWidth = 0.8;
        context.strokeStyle = point.active ? "rgba(212,242,247,.78)" : "rgba(183,205,212,.48)";
        context.stroke();

        if (currentSettings.show_satellite_names) {
          context.font = "8px ui-monospace, monospace";
          context.textBaseline = "middle";
          context.lineWidth = 3;
          context.strokeStyle = "rgba(1,8,13,.88)";
          context.strokeText(point.name, screen.x + markerRadius + 4, screen.y);
          context.fillStyle = point.active ? "rgba(217,232,237,.9)" : "rgba(151,176,185,.72)";
          context.fillText(point.name, screen.x + markerRadius + 4, screen.y);
        }
      }
      projectedRef.current = projected;
    };

    const onMouseMove = (event: MapMouseEvent) => {
      const point = nearestPoint(projectedRef.current, event.point.x, event.point.y);
      if (!point) {
        map.getCanvas().style.cursor = "";
        setHover(null);
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      setHover({name: point.name, x: event.point.x + 12, y: event.point.y + 12});
    };
    const onClick = (event: MapMouseEvent) => {
      const point = nearestPoint(projectedRef.current, event.point.x, event.point.y);
      if (point) onSelect(point.norad_id);
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
    };

    map.on("render", draw);
    map.on("mousemove", onMouseMove);
    map.on("click", onClick);
    map.getCanvas().addEventListener("mouseleave", onMouseLeave);
    draw();

    return () => {
      map.off("render", draw);
      map.off("mousemove", onMouseMove);
      map.off("click", onClick);
      map.getCanvas().removeEventListener("mouseleave", onMouseLeave);
      map.getCanvas().style.cursor = "";
      projectedRef.current = [];
    };
  }, [mapSession, onSelect]);

  return (
    <div className="group-satellite-overlay" aria-hidden="true">
      <canvas ref={canvasRef}/>
      {hover && <div className="group-satellite-hover" style={{left: hover.x, top: hover.y}}>{hover.name}</div>}
    </div>
  );
}

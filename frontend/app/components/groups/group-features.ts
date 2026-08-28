import type {GroupPosition} from "../../domain/satellite";

export type GroupRenderPoint = {
  satellite_id: number;
  norad_id: string;
  name: string;
  active: boolean;
  lat: number;
  lon: number;
  altitude: number;
  heading: number | null;
};

export function buildGroupRenderPoints(
  positions: GroupPosition[],
  selectedNoradId: string,
): GroupRenderPoint[] {
  return positions.flatMap((item) => {
    if (!item.position || !item.satellite.norad_id || item.satellite.norad_id === selectedNoradId) return [];
    return [{
      satellite_id: item.satellite.id,
      norad_id: item.satellite.norad_id,
      name: item.satellite.name,
      active: item.satellite.active,
      lat: item.position.lat_deg,
      lon: item.position.lon_deg,
      altitude: item.position.altitude_km,
      heading: item.position.heading_deg,
    }];
  });
}

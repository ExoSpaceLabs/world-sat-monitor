import type {Feature, MultiPolygon} from "geojson";

const DEG = Math.PI / 180;

function normalizeLongitude(longitude: number) {
  return (((longitude % 360) + 540) % 360) - 180;
}

export type SolarState = {
  latitude: number;
  longitude: number;
};

export function getSolarState(date: Date): SolarState {
  const julianDay = date.getTime() / 86_400_000 + 2_440_587.5;
  const daysSinceJ2000 = julianDay - 2_451_545;
  const meanLongitude = (280.46 + 0.9856474 * daysSinceJ2000) * DEG;
  const meanAnomaly = (357.528 + 0.9856003 * daysSinceJ2000) * DEG;
  const eclipticLongitude = meanLongitude + 1.915 * DEG * Math.sin(meanAnomaly) + 0.02 * DEG * Math.sin(2 * meanAnomaly);
  const obliquity = (23.439 - 0.0000004 * daysSinceJ2000) * DEG;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const centuries = daysSinceJ2000 / 36_525;
  const siderealDegrees = 280.46061837 + 360.98564736629 * daysSinceJ2000 + 0.000387933 * centuries * centuries;

  return {
    latitude: declination / DEG,
    longitude: normalizeLongitude(rightAscension / DEG - siderealDegrees),
  };
}

function terminatorLatitude(longitude: number, sun: SolarState) {
  const hourAngle = (longitude - sun.longitude) * DEG;
  const declination = sun.latitude * DEG;
  return Math.atan2(-Math.cos(declination) * Math.cos(hourAngle), Math.sin(declination)) / DEG;
}

export function createNightRegion(date: Date): Feature<MultiPolygon> {
  const sun = getSolarState(date);
  const pole = sun.latitude >= 0 ? -90 : 90;
  const strips: Array<[number, number]> = [[-180, 0], [0, 180]];
  const coordinates = strips.map(([start, end]) => {
    const ring: number[][] = [[start, pole], [end, pole]];
    for (let longitude = end; longitude >= start; longitude -= 2) {
      ring.push([longitude, terminatorLatitude(longitude, sun)]);
    }
    ring.push([start, pole]);
    return [ring];
  });

  return {
    type: "Feature",
    properties: {utc: date.toISOString()},
    geometry: {type: "MultiPolygon", coordinates},
  };
}

export function solarElevation(latitude: number, longitude: number, sun: SolarState) {
  const lat = latitude * DEG;
  const sunLat = sun.latitude * DEG;
  const deltaLon = (longitude - sun.longitude) * DEG;
  return Math.asin(
    Math.sin(lat) * Math.sin(sunLat) + Math.cos(lat) * Math.cos(sunLat) * Math.cos(deltaLon),
  ) / DEG;
}

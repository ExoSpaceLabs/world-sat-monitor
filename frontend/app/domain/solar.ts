const DEG = Math.PI / 180;
const MILLISECONDS_PER_DAY = 86_400_000;
const JULIAN_UNIX_EPOCH = 2_440_587.5;
const JULIAN_J2000 = 2_451_545;

function normalizeSolarLongitude(longitude: number) {
  return (((longitude % 360) + 540) % 360) - 180;
}

export type SolarState = {
  /** Solar declination, shared by Earth-fixed and inertial frames. */
  latitude: number;
  /** Subsolar longitude in the Earth-fixed frame. */
  longitude: number;
  /** Solar right ascension in the Earth-centred inertial frame. */
  rightAscension: number;
  /** Greenwich mean sidereal angle used to rotate Earth-fixed directions into ECI. */
  siderealAngle: number;
};

export const DEFAULT_SHADOW_OPACITY = 0.7;

function julianState(date: Date) {
  const julianDay = date.getTime() / MILLISECONDS_PER_DAY + JULIAN_UNIX_EPOCH;
  const daysSinceJ2000 = julianDay - JULIAN_J2000;
  return {
    daysSinceJ2000,
    centuries: daysSinceJ2000 / 36_525,
  };
}

function greenwichSiderealDegrees(date: Date) {
  const {daysSinceJ2000, centuries} = julianState(date);
  return normalizeSolarLongitude(
    280.46061837
      + 360.98564736629 * daysSinceJ2000
      + 0.000387933 * centuries * centuries,
  );
}

export function getSolarState(date: Date): SolarState {
  const {daysSinceJ2000} = julianState(date);
  const meanLongitude = (280.46 + 0.9856474 * daysSinceJ2000) * DEG;
  const meanAnomaly = (357.528 + 0.9856003 * daysSinceJ2000) * DEG;
  const eclipticLongitude = meanLongitude
    + 1.915 * DEG * Math.sin(meanAnomaly)
    + 0.02 * DEG * Math.sin(2 * meanAnomaly);
  const obliquity = (23.439 - 0.0000004 * daysSinceJ2000) * DEG;
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscensionDegrees = normalizeSolarLongitude(rightAscension / DEG);
  const siderealAngle = greenwichSiderealDegrees(date);

  return {
    latitude: declination / DEG,
    longitude: normalizeSolarLongitude(rightAscensionDegrees - siderealAngle),
    rightAscension: rightAscensionDegrees,
    siderealAngle,
  };
}

/** Dot product between a surface normal at lon/lat and the Earth-fixed Sun direction. */
export function solarIllumination(latitude: number, longitude: number, sun: SolarState) {
  const lat = latitude * DEG;
  const sunLat = sun.latitude * DEG;
  const deltaLon = (longitude - sun.longitude) * DEG;
  return Math.sin(lat) * Math.sin(sunLat)
    + Math.cos(lat) * Math.cos(sunLat) * Math.cos(deltaLon);
}

export function solarElevation(latitude: number, longitude: number, sun: SolarState) {
  const illumination = Math.max(-1, Math.min(1, solarIllumination(latitude, longitude, sun)));
  return Math.asin(illumination) / DEG;
}

export function shadowAlpha(illumination: number, opacity = DEFAULT_SHADOW_OPACITY) {
  if (illumination >= 0) return 0;
  const terminatorBlend = Math.min(1, -illumination / 0.025);
  return opacity * terminatorBlend;
}

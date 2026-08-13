/* ===== Subsolar point (sun's direct latitude/longitude) calculation =====
   Uses the low-precision NOAA solar position algorithm (sufficient precision within the 20th-21st centuries):
   - decl: solar declination (determines the latitude of the subsolar point, this page does not use it for the time being)
   - eot:  equation of time (minutes), corrects the difference between apparent solar time and mean solar time
   - The subsolar longitude is derived from "current UTC time + equation of time":
     at 12:00 UTC the subsolar point lies near longitude 0°, decreasing by 15° westward for each additional hour. */

const TWO_PI = Math.PI * 2

export function subsolarPoint(date = new Date()) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0)
  const dayOfYear = (date.getTime() - startOfYear) / 86400000
  const frac = (TWO_PI / 365) * (dayOfYear - 1 + (date.getUTCHours() - 12) / 24)

  /* Solar declination (radians) */
  const decl =
    0.006918 -
    0.399912 * Math.cos(frac) +
    0.070257 * Math.sin(frac) -
    0.006758 * Math.cos(2 * frac) +
    0.000907 * Math.sin(2 * frac) -
    0.002697 * Math.cos(3 * frac) +
    0.00148 * Math.sin(3 * frac)

  /* Equation of time (minutes) */
  const eot =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(frac) -
      0.032077 * Math.sin(frac) -
      0.014615 * Math.cos(2 * frac) -
      0.040849 * Math.sin(2 * frac))

  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  let lon = (12 - utcHours) * 15 - eot * 0.25
  lon = ((lon + 540) % 360) - 180

  return { lat: (decl * 180) / Math.PI, lon }
}

/* Current subsolar longitude (degrees, east positive west negative, range [-180, 180]) */
export function subsolarLongitude(date = new Date()) {
  return subsolarPoint(date).lon
}
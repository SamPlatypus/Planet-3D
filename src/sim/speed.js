// The speed slider is logarithmic: 0 = real time, 1 = one year per second.
const LOG_MIN = Math.log10(1 / 86400);
const LOG_MAX = Math.log10(365.25);

/** Slider position (0..1) -> simulated days per real second. */
export const speedFromSlider = (t) => Math.pow(10, LOG_MIN + (LOG_MAX - LOG_MIN) * t);

/** Simulated days per real second -> slider position (0..1). */
export const sliderFromSpeed = (d) => (Math.log10(d) - LOG_MIN) / (LOG_MAX - LOG_MIN);

/** Snap points: real time, 1 min/s, 1 h/s, 1 day/s, 1 week/s, 1 month/s, 1 year/s. */
export const SPEED_DETENTS = [1 / 86400, 1 / 1440, 1 / 24, 1, 7, 30.44, 365.25].map(sliderFromSpeed);

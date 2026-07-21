export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
export const WHEEL_DIVISOR = 100;
export const PINCH_SENSITIVITY = 2.5;

// Fill tool: max flood-fill radius (edge-steps from the seed trixel). The grid
// is infinite, so an un-enclosed region would spread forever — if the fill
// reaches this radius it is treated as unbounded and aborted.
export const FILL_MAX_RADIUS = 24;

/* The DsField camera as plain numbers (no three import), so a host can project
 * world<->screen without pulling the engine into its bundle. field.tsx feeds
 * these to its <Canvas>; a host's own projection reads the same values. One source
 * of truth, so the projection can't silently drift from the actual camera. */
export const FIELD_CAMERA = { z: 8.2, fov: 45 } as const;

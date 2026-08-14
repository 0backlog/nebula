/* @0backlog/nebula: the public surface.
 *
 * Four layers, all optional past the first:
 *   1. the engine (DsField) and the formation contract
 *   2. the generic formations
 *   3. the three.js shapes adapter
 *   4. the talking face: its formation, its asset format, and its voice drive
 *
 * Every dial-like number across the surface runs on one 0..10 scale: 0 the
 * minimum, 10 the maximum, 5 always the nominal tuned value. dial10 is the
 * one mapping between a dial and its internal units.
 *
 * The whole package is one ESM entry. It carries a "use client" directive, so
 * a React Server Components host can import it from a client boundary without
 * a wrapper of its own. */

export {
  dial10,
  DsField,
  fieldHash01,
  type DsFieldProps,
  type FieldCursorMode,
  type FieldFormation,
  type FieldInset,
  type FieldLiveCtx,
  type FieldSpotlight,
  type FieldViewport,
} from "./field.js";

export { FIELD_CAMERA } from "./field-camera.js";

export {
  composedFormation,
  geometryFormation,
  sampleGeometrySurface,
  type ShapeOpts,
  type ShapePart,
} from "./field-shapes.js";

export {
  cloudFormation,
  curtainFormation,
  dnaFormation,
  flowerFormation,
  horizonFormation,
  hourglassFormation,
  latticeFormation,
  streamFormation,
  veinsFormation,
  type CloudOpts,
  type CurtainOpts,
  type DnaOpts,
  type FlowerOpts,
  type HorizonOpts,
  type HourglassOpts,
  type LatticeOpts,
  type StreamOpts,
  type VeinsOpts,
} from "./formations.js";

export { faceFormation, type FaceFormationOpts } from "./field-face.js";

export {
  buildDeformWeights,
  DEFAULT_FACE,
  FACE_FEATURE_PEAK,
  FACE_FEATURE_PLAIN,
  FACE_FEATURE_WEIGHT,
  FACE_LANDMARK_COUNT,
  FACE_REGIONS,
  MOUTH_TRAVEL,
  parseFaceAsset,
  ROUND_TRAVEL,
  SPREAD_TRAVEL,
  toFaceGeometry,
  type FaceAsset,
  type FaceDeform,
  type FaceGeometry,
} from "./field-face-asset.js";

export {
  attachFaceAudio,
  clearFaceDrive,
  resumeFaceAudio,
  setFaceDrive,
  setFaceDriveGain,
  setFaceGesture,
  type FaceDrive,
} from "./field-face-drive.js";

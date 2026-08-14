/* The mark: the one shader pair the engine draws with whenever anything asks
 * more of a dot than the plain PointsMaterial can say (shine, glow, round
 * corners, the additive halo, a light pocket). Strings only, no three.js and
 * no React: the engine owns the uniforms, this file owns what they mean. */

// how many light pockets ride at once. Fixed, because it is the size of the
// shader's uniform arrays; extras in the host's list are ignored.
export const SPOT_MAX = 4;

/* shine: a per-point shimmer. The vertex shader reproduces PointsMaterial's
 * size attenuation; alpha drifts on each point's own random clock when uShine
 * is 1 (and stays flat at 1 when 0). This shader is the normal path, not the
 * exception: shine, glow, round, additive or a light pocket all select it (see
 * useShader in field.tsx), and round defaults to 10. */
export const SHINE_VERT = `
  attribute float aRand;
  attribute float aGlow;
  uniform float uSize;
  uniform float uScale;
  uniform float uTime;
  uniform float uShine;
  uniform float uAdditive;
  uniform vec3 uColor;
  uniform vec3 uTint[${SPOT_MAX}];
  uniform float uTintAmt[${SPOT_MAX}];
  uniform vec3 uSpot[${SPOT_MAX}];
  uniform float uSpotInv[${SPOT_MAX}];
  uniform int uSpotN;
  varying float vA;
  varying vec3 vC;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // size matches the plain material exactly: the glow lifts BRIGHTNESS only,
    // never the dot size (a fatter dot at the node read wrong). The additive
    // halo (uAdditive, numeric hosts only) is the one thing that widens the
    // quad: its soft falloff needs room to breathe.
    gl_PointSize = uSize * uScale / max(0.0001, -mv.z) * (1.0 + uAdditive * 0.5);
    // shimmer oscillates SYMMETRICALLY around 1.0 so the average brightness is
    // identical to the plain material (shine ON = OFF + a twinkle, never dimmer
    // and never a color shift); each point on its own random phase. uShine is
    // an AMOUNT (0 = off, 1 = the classic twinkle, >1 = violent flicker), and
    // the tempo is fixed well above the resting breath so the two never read
    // as one coupled motion.
    float tw = 1.0 + 0.2 * uShine * sin(uTime * 3.5 + aRand * 6.2831853);
    // base brightness (shine twinkle) times the per-point glow (1 when idle)
    vA = tw * aGlow;
    // a tinted spotlight is the one thing that moves a point's COLOR. The
    // weight is the same gaussian the cpu ran for this point's brightness,
    // recomputed here from the very position it ran on (both live in group
    // space, and uSpot arrives mapped into it), so the colored pocket and the
    // bright pocket are one pocket and no second attribute has to ride along.
    // Only the TINTED pockets are packed into these arrays, so uSpotN is 0 for
    // an untinted field, the loop breaks on its first test, and every point
    // carries the field's own color exactly as before. Two overlapping tints
    // mix in list order, each leaning the running color the rest of the way by
    // its own weight, so a point in two pockets takes color from both.
    vC = uColor;
    for (int k = 0; k < ${SPOT_MAX}; k++) {
      if (k >= uSpotN) break;
      vec3 dl = position - uSpot[k];
      vC = mix(vC, uTint[k], uTintAmt[k] * exp(-dot(dl, dl) * uSpotInv[k]));
    }
  }
`;
// the mark's SHAPE follows uRound, from the square PointsMaterial draws to a
// circle, and matching shape is what keeps shine ON looking like OFF rather
// than a different mark. The tonemapping + colorspace includes are what make
// the COLOR match too: r3f runs PointsMaterial through ACES tone mapping +
// sRGB encode, and a bare shader output would skip both and read more
// saturated/blue.
export const SHINE_FRAG = `
  uniform float uOpacity;
  uniform float uRound;
  uniform float uAdditive;
  varying float vA;
  // the point's color arrives from the vertex stage: the field tint, or that
  // tint already leaned toward a spotlight's own color (see SHINE_VERT)
  varying vec3 vC;
  void main() {
    // the mark is a rounded-square SDF: uRound dials the corner radius from
    // a hard square (0) through rounded corners to a circle (1).
    vec2 pc = abs(gl_PointCoord - 0.5);
    float cr = 0.5 * clamp(uRound, 0.0, 1.0);
    vec2 q = pc - (0.5 - cr);
    float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - cr;
    // uAdditive (numeric hosts) softens the edge into a halo and overdrives
    // the core, the glow half of additive blending.
    float soft = 0.32 * uAdditive;
    float mask;
    if (soft > 0.001) {
      mask = clamp(-d / soft, 0.0, 1.0);
      mask *= mask * (1.0 + uAdditive * 0.8);
    } else {
      // ~1px analytic edge softness on the bare mark: a hard discard at 1-2px
      // dot sizes flips whole pixels as dots drift sub-pixel (the canvas runs
      // antialias off), which reads as twinkle even at shine 0
      float aa = max(fwidth(d), 1e-4);
      mask = 1.0 - smoothstep(-aa, aa, d);
    }
    if (mask < 0.004) discard;
    gl_FragColor = vec4(vC, uOpacity * vA * mask);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

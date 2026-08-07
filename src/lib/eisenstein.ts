/**
 * Exactly-repeating settings for the pattern brush.
 *
 * The trixel lattice is the Eisenstein integers: `triCenter(q, r, …)` puts a
 * cell at `q + r·ω` in edge-length units, with `ω = e^{iπ/3}`. The pattern
 * brush samples each centroid through `p ↦ s·e^{iθ}·p` and re-quantizes, so the
 * whole question of "does this pattern repeat" is the question of what that one
 * complex multiplier does to the lattice.
 *
 * Write `M = s·e^{iθ}`. If `M = α/β` for Eisenstein integers α and β, then for
 * any lattice vector `v ∈ βZ[ω]`,
 *
 *     M(p + v) = M(p) + α·(v/β)   and   v/β ∈ Z[ω],
 *
 * so the sample lands in a lattice *translate* of where it landed before —
 * which preserves up/down parity, and therefore the pattern value. The pattern
 * is exactly periodic, with a cell of `|β| = √N(β)` trixel edges.
 *
 * That is the complete answer: **every exactly-repeating (scale, rotation) pair
 * is an Eisenstein ratio**, and its repeat distance is fixed by the denominator
 * alone. The familiar "magic angle" ladder of coincidence-site lattices is the
 * `β = ᾱ` slice of this, where `|α| = |β|` forces `s = 1` and the rotation comes
 * out as `2·arg(α)` — Σ7 at 38.213°, Σ13 at 27.796°, and so on. Nothing here is
 * special to scale 1; the brush has two sliders and the ladder is genuinely
 * two-dimensional.
 *
 * Verified numerically by translating sample points along β-lattice vectors and
 * confirming the value is unchanged.
 *
 * **These are offered, never imposed.** Snapping rotation to the lattice's own
 * symmetry was tried and reverted (see docs/pattern-brush.md) because it makes
 * the entire emergent family unreachable — the aliasing *is* the feature. What
 * follows marks landmarks in a continuous space; it does not quantize it.
 */

/** `m + n·ω`, with `ω = e^{iπ/3}`. */
export type Eis = readonly [number, number];

/** The Eisenstein norm `N(m + nω) = m² + mn + n²`. Also the squared distance,
 *  which is why `√N` is a length in trixel edges. */
export function eisNorm([m, n]: Eis): number {
  return m * m + m * n + n * n;
}

const W_RE = 0.5;
const W_IM = Math.sqrt(3) / 2;
const FOLD = 60;

interface Cx {
  re: number;
  im: number;
}

const toComplex = ([m, n]: Eis): Cx => ({ re: m + n * W_RE, im: n * W_IM });

/**
 * The lattice point closest to an arbitrary complex number.
 *
 * Inverting the basis gives real `(m, n)`; rounding both is *not* enough on its
 * own, because the basis is not orthogonal and the rounded pair can lose to a
 * neighbour by as much as the cell's covering radius. Checking the nine
 * candidates around the rounded pair costs nothing and makes it exact.
 */
function nearestEis(z: Cx): Eis {
  const n0 = z.im / W_IM;
  const m0 = z.re - n0 * W_RE;
  let best: Eis = [Math.round(m0), Math.round(n0)];
  let bestD = Infinity;
  for (let dm = -1; dm <= 1; dm++) {
    for (let dn = -1; dn <= 1; dn++) {
      const cand: Eis = [Math.round(m0) + dm, Math.round(n0) + dn];
      const c = toComplex(cand);
      const d = (c.re - z.re) ** 2 + (c.im - z.im) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
  }
  return best;
}

/** One exactly-repeating setting of the two sliders. */
export interface Coincidence {
  alpha: Eis;
  beta: Eis;
  /** `√(N(α)/N(β))`. */
  scale: number;
  /** `arg α − arg β`, folded into `[0, 60)` degrees. A 60° turn maps the
   *  lattice onto itself but exchanges up and down triangles, so angles 60°
   *  apart give the same geometry with the two colours swapped — which is why
   *  landmarks are reported folded and `snapRotation` re-lifts them. */
  rotation: number;
  /** Repeat cell in trixel edges, `√N(β)`. */
  period: number;
}

export interface Detune {
  /** The landmark this setting is closest to. */
  near: Coincidence;
  /** Relative distance of the multiplier from the landmark's, `|M − M₀|/|M₀|`.
   *  Zero exactly on it. */
  epsilon: number;
  /** Distance over which the motif drifts back into register, in trixel edges:
   *  `period / epsilon`. Infinite when exactly on the landmark. */
  beat: number;
}

export interface CoincidenceOpts {
  /** Repeat cells outside this band are excluded. Below ~2.5 edges the motif is
   *  texture rather than structure; above ~12 it cannot repeat inside a hex, so
   *  naming it tells the user nothing they can see. `√7 ≈ 2.646` — the tightest
   *  landmark anyone actually reaches for — must stay inside the lower bound. */
  minPeriod?: number;
  maxPeriod?: number;
  /** Matches the panel's own slider range; a landmark outside it is unreachable. */
  minScale?: number;
  maxScale?: number;
}

/**
 * The best-fitting landmarks for a given pair of slider values, closest first.
 *
 * The set of exactly-repeating multipliers is *dense* — between any two there
 * are more, exactly as with the rationals — so there is no ladder to enumerate
 * and no catalogue worth putting in a panel. What is well defined is the
 * nearest landmark **for each repeat cell**, and that one has a closed form: for
 * a fixed β the ideal numerator is `M·β` exactly, so the best available α is
 * simply the lattice point nearest to it. One rounding per denominator, no
 * search, and the answer is exact rather than the best of whatever was
 * precomputed.
 *
 * Scale and rotation collapse into a single error because the pattern only ever
 * sees their product: the mismatch is `ε = |M − M₀|/|M₀|`, and the motif drifts
 * out of register over `period/ε`. That is why a scale nudge and a rotation
 * nudge blur the result the same way, and why they can cancel each other.
 *
 * Ranked by `ε · period` rather than by `ε` alone. A tight cell slightly out of
 * true is far more visible than a huge cell almost exactly in true, because the
 * huge one has no room to repeat inside the artwork. The epsilon floor in the
 * score only breaks ties toward the tighter cell when the fit is already exact.
 */
export function nearbyCoincidences(
  scale: number,
  rotation: number,
  count: number,
  {
    minPeriod = 2.5,
    maxPeriod = 12,
    minScale = 0.1,
    maxScale = 6,
  }: CoincidenceOpts = {},
): Detune[] {
  const folded = ((rotation % FOLD) + FOLD) % FOLD;
  const th = (folded * Math.PI) / 180;
  const M: Cx = { re: scale * Math.cos(th), im: scale * Math.sin(th) };

  const minN = minPeriod * minPeriod;
  const maxN = maxPeriod * maxPeriod;
  const lim = Math.ceil(maxPeriod) + 1;

  // Keyed on the multiplier as the user sees it, so associates and unreduced
  // ratios collapse; denominators are visited smallest-first, so the reduced
  // form — the honest period — is the one that gets kept.
  const seen = new Map<string, Detune & { score: number }>();

  const betas: Eis[] = [];
  for (let m = -lim; m <= lim; m++) {
    for (let n = -lim; n <= lim; n++) {
      const N = eisNorm([m, n]);
      if (N >= minN && N <= maxN) betas.push([m, n]);
    }
  }
  betas.sort((a, b) => eisNorm(a) - eisNorm(b));

  for (const beta of betas) {
    const nb = eisNorm(beta);
    const cb = toComplex(beta);

    // The numerator that would make this exact, then the nearest one that exists.
    const alpha = nearestEis({
      re: M.re * cb.re - M.im * cb.im,
      im: M.re * cb.im + M.im * cb.re,
    });
    const na = eisNorm(alpha);
    if (na === 0) continue;

    const s = Math.sqrt(na / nb);
    if (s < minScale || s > maxScale) continue;

    const ca = toComplex(alpha);
    let rot =
      ((Math.atan2(ca.im, ca.re) - Math.atan2(cb.im, cb.re)) * 180) / Math.PI;
    rot = ((rot % FOLD) + FOLD) % FOLD;
    if (rot > FOLD - 1e-9) rot = 0;

    const key = `${s.toFixed(6)}:${rot.toFixed(6)}`;
    if (seen.has(key)) continue;

    const period = Math.sqrt(nb);
    // |M − α/β| / |α/β|, evaluated as |Mβ − α| / |α|.
    const eps =
      Math.hypot(
        M.re * cb.re - M.im * cb.im - ca.re,
        M.re * cb.im + M.im * cb.re - ca.im,
      ) / Math.sqrt(na);

    seen.set(key, {
      near: { alpha, beta, scale: s, rotation: rot, period },
      epsilon: eps,
      beat: eps < 1e-9 ? Infinity : period / eps,
      score: (eps + 1e-4) * period,
    });
  }

  return [...seen.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, count)
    .map(({ near, epsilon, beat }) => ({ near, epsilon, beat }));
}

/** The single best-fitting landmark, or `null` if none is in range. */
export function nearestCoincidence(
  scale: number,
  rotation: number,
  opts?: CoincidenceOpts,
): Detune | null {
  return nearbyCoincidences(scale, rotation, 1, opts)[0] ?? null;
}

/**
 * The rotation to actually write to the slider when snapping to `target`.
 *
 * Landmarks are reported folded into `[0, 60)`, but the slider runs 0–360 and
 * every lift 60° apart is the same geometry. Jumping to the *nearest* lift means
 * snapping nudges the control instead of throwing it across its range — and
 * keeps whichever of the two colour phases the user was already looking at.
 */
export function snapRotation(target: number, current: number): number {
  const base = ((target % FOLD) + FOLD) % FOLD;
  const k = Math.round((current - base) / FOLD);
  return Math.min(360, Math.max(0, base + k * FOLD));
}

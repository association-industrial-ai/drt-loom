/**
 * Deterministic RNG. Every run of `npm run gen` must produce a byte-identical
 * dataset — the demo is scripted, the eval gold answers are precomputed, and a
 * shifting corpus would invalidate both.
 */

/** mulberry32 — small, fast, good enough distribution for synthetic data. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof makeRng>;

/** Integer in [min, max] inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error("pick() from empty array");
  return xs[Math.floor(rng() * xs.length)]!;
}

/** `n` distinct items, or all of them if n >= xs.length. */
export function pickMany<T>(rng: Rng, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return out;
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Round to `dp` decimals — keeps money out of float-noise territory. */
export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/* --------------------------------------------------------------------------
   Dates. The demo is anchored to a fixed "today" so that relative reasoning
   ("effective before October", "the September batch") stays stable forever.
   -------------------------------------------------------------------------- */

/** The scenario's present day. Never use the real clock in the generator. */
export const TODAY = "2026-07-28";

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const ms =
    new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** Random date in [from, to]. */
export function dateBetween(rng: Rng, from: string, to: string): string {
  return addDays(from, int(rng, 0, Math.max(0, daysBetween(from, to))));
}

/** Zero-padded id suffix, e.g. seq(42, 4) -> "0042". */
export function seq(n: number, width = 4): string {
  return String(n).padStart(width, "0");
}

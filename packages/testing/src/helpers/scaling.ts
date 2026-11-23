/**
 * Scaling checks. A case times the same step at `n` and `8n` and bounds the ratio: linear work
 * grows about 8x (n log n about 10x), quadratic work 64x. A ratio, not a wall-clock budget, so a
 * slow runner cannot fail it; the best of several runs absorbs a stray pause or GC.
 */
import { expect } from 'vitest'

/** How many times larger the second input is than the first. */
const SCALE = 8

/**
 * Linear growth is 8x; 20x leaves 2.5x room for allocation and GC noise on a slow runner and still
 * fails anything quadratic (64x) by a factor of three.
 */
const MAX_GROWTH = 20
const RUNS = 5

/** Repeats `run` for at least `MIN_SAMPLE_MS`, so a millisecond clock still times a fast step. */
const MIN_SAMPLE_MS = 100

function perRunMs(run: () => void): number {
  const start = Date.now()
  let runs = 0
  let elapsed = 0
  do {
    run()
    runs += 1
    elapsed = Date.now() - start
  } while (elapsed < MIN_SAMPLE_MS)
  return elapsed / runs
}

/**
 * How much slower the step runs at `8n` than at `n`. `make(n)` builds the input untimed and
 * returns the step. Small and large runs alternate, so a burst of machine load slows both sides
 * of the ratio instead of one; each side keeps its best run. A linear step stops as soon as its
 * ratio is under `MAX_GROWTH`, and a quadratic one never gets there.
 */
function growth(make: (n: number) => () => void, n: number): number {
  make(n)()
  make(SCALE * n)()
  let small = Number.POSITIVE_INFINITY
  let large = Number.POSITIVE_INFINITY
  for (let i = 0; i < RUNS; i += 1) {
    small = Math.min(small, perRunMs(make(n)))
    large = Math.min(large, perRunMs(make(SCALE * n)))
    if (i > 0 && large / small < MAX_GROWTH) break
  }
  return large / small
}

/**
 * Asserts the step `make(n)` returns grows linearly (or n log n) from `n` to `8n`, failing
 * anything quadratic. `make` builds the input outside the timed step.
 */
export function expectLinearGrowth(make: (n: number) => () => void, n: number): void {
  expect(growth(make, n)).toBeLessThan(MAX_GROWTH)
}

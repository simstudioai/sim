/**
 * Scaling checks for the engines. A case times the same step at `n` and `4n` and bounds the ratio:
 * linear work grows about 4x, quadratic work 16x. A ratio, not a wall-clock budget, so a slow
 * runner cannot fail it; the best of several runs absorbs a stray pause or GC.
 */

/** Linear growth is 4x; 9x leaves room for noise and still fails anything quadratic (16x). */
export const MAX_GROWTH = 9
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
 * How much slower the step runs at `4n` than at `n`. `make(n)` builds the input untimed and
 * returns the step. Small and large runs alternate, so a burst of machine load slows both sides
 * of the ratio instead of one; each side keeps its best run. A linear step stops as soon as its
 * ratio is under `MAX_GROWTH`, and a quadratic one never gets there.
 */
export function growth(make: (n: number) => () => void, n: number): number {
  make(n)()
  make(4 * n)()
  let small = Number.POSITIVE_INFINITY
  let large = Number.POSITIVE_INFINITY
  for (let i = 0; i < RUNS; i += 1) {
    small = Math.min(small, perRunMs(make(n)))
    large = Math.min(large, perRunMs(make(4 * n)))
    if (i > 0 && large / small < MAX_GROWTH) break
  }
  return large / small
}

/**
 * Scaling checks for the engines. A case times the same step at `n` and `4n` and bounds the ratio:
 * linear work grows about 4x, quadratic work 16x. A ratio, not a wall-clock budget, so a slow
 * runner cannot fail it; the best of several runs absorbs a stray pause or GC.
 */

/** Linear growth is 4x; 9x leaves room for noise and still fails anything quadratic (16x). */
export const MAX_GROWTH = 9
const RUNS = 5

/** Repeats `run` for at least `MIN_SAMPLE_MS`, so a millisecond clock still times a fast step. */
const MIN_SAMPLE_MS = 40

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
 * returns the step. The large size stops at the first run under `MAX_GROWTH`, so a linear step
 * costs one large run and a quadratic one fails without waiting on more.
 */
export function growth(make: (n: number) => () => void, n: number): number {
  make(n)()
  let small = Number.POSITIVE_INFINITY
  for (let i = 0; i < RUNS; i += 1) small = Math.min(small, perRunMs(make(n)))
  let ratio = Number.POSITIVE_INFINITY
  for (let i = 0; i < RUNS && ratio >= MAX_GROWTH; i += 1) {
    ratio = Math.min(ratio, perRunMs(make(4 * n)) / small)
  }
  return ratio
}

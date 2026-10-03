/**
 * Repeated mention of a tag name that never closes — the shape both the parser
 * and the display sanitizer used to be quadratic on, because a scan allowed to
 * cross an opener restarts from every opener.
 */
function buildRepeatedTagMentions(times: number): string {
  return 'The <workspace_resource> tag is used here. '.repeat(times)
}

/** Fastest of five runs, so a single scheduling hiccup cannot skew the sample. */
function fastest(run: (content: string) => void, content: string): number {
  let best = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < 5; attempt++) {
    const startedAt = performance.now()
    run(content)
    best = Math.min(best, performance.now() - startedAt)
  }
  return best
}

/**
 * How much slower `run` gets when its input grows 4x.
 *
 * Complexity is asserted as a RATIO rather than a wall-clock ceiling. A fixed
 * millisecond bound measures the machine as much as the algorithm: it fails on a
 * loaded CI box, and set generously enough not to, it lets a genuine quadratic
 * through at the single size it happens to sample. Quadratic costs ~16x for 4x
 * the input; linear costs ~4x. The median of three independent ratios is
 * returned, so one noisy trial in either direction — a GC pause inflating a
 * sample, or a lucky one deflating it — cannot decide the result on its own.
 */
export function scalingRatioOver4x(
  run: (content: string) => void,
  buildContent: (times: number) => string = buildRepeatedTagMentions
): number {
  // Warm up first — the JIT would otherwise charge the whole compile to the
  // small sample and flatter the ratio.
  const smallContent = buildContent(2_000)
  const largeContent = buildContent(8_000)
  fastest(run, smallContent)

  const ratios: number[] = []
  for (let trial = 0; trial < 3; trial++) {
    ratios.push(fastest(run, largeContent) / fastest(run, smallContent))
  }
  ratios.sort((a, b) => a - b)
  return ratios[1]
}

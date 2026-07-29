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
 * the input; linear costs ~4x.
 */
export function scalingRatioOver4x(run: (content: string) => void): number {
  // Warm up first — the JIT would otherwise charge the whole compile to the
  // small sample and flatter the ratio.
  fastest(run, buildRepeatedTagMentions(2_000))

  const small = fastest(run, buildRepeatedTagMentions(2_000))
  const large = fastest(run, buildRepeatedTagMentions(8_000))

  return large / small
}

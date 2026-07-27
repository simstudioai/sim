import { RE2JS } from 're2js'

/**
 * Linear-time matching for caller-supplied regex patterns.
 *
 * The built-in engine backtracks, so a pattern chosen by a caller can take
 * exponential time on input the same caller controls — `a*a*b` against a 10k
 * run of `a` measured 213s on JSC and 132s on V8. Anywhere that runs on a
 * shared event loop, that is a denial of service against every other tenant.
 *
 * Screening the pattern instead does not work. `safe-regex2` documents itself
 * as having false negatives and passes `(a|a)*b`; rejecting quantified groups
 * on top of it still passes `a*a*b`. Every syntactic rule only excludes the
 * shapes someone thought to enumerate, so the engine has to change instead.
 *
 * RE2 has no backtracking and matches in time linear in the input. The cost is
 * throughput (~100x the built-in engine, roughly 25ms/MB) and syntax: RE2
 * implements neither lookaround nor backreferences, so `compileLinearRegex`
 * returns `null` for those and each caller decides how to degrade.
 */
export interface LinearRegexOptions {
  ignoreCase?: boolean
}

export interface LinearRegex {
  /** Whether the pattern matches anywhere in `text`. */
  test(text: string): boolean
  /** Index of the first match in `text`, or -1. */
  find(text: string): number
  /** Split `text` around every match, like `String.prototype.split(regex)`. */
  split(text: string): string[]
}

/** Escape every regex metacharacter so `input` matches only itself. */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when `pattern` has no metacharacter, so both engines behave identically. */
export function isPlainText(pattern: string): boolean {
  return !/[.*+?^${}()|[\]\\]/.test(pattern)
}

/**
 * Match `pattern` as an escaped literal on the built-in engine.
 *
 * Safe because an escaped literal cannot backtrack, and ~100x quicker than RE2
 * — worth taking whenever the pattern has no metacharacter to interpret, or as
 * a degradation path when RE2 rejects the syntax.
 */
export function literalRegex(pattern: string, options: LinearRegexOptions = {}): LinearRegex {
  const source = escapeRegExp(pattern)
  const caseFlag = options.ignoreCase ? 'i' : ''
  // Non-global, so `exec`/`test` keep no `lastIndex` between calls and one
  // instance is reusable — callers scan line-by-line, and recompiling per line
  // would dominate the cost. `split` needs the global form, which
  // `String.prototype.split` clones rather than mutating.
  const scanner = new RegExp(source, caseFlag)
  const splitter = new RegExp(source, `g${caseFlag}`)
  return {
    test: (text) => scanner.test(text),
    find: (text) => {
      const match = scanner.exec(text)
      return match ? match.index : -1
    },
    split: (text) => text.split(splitter),
  }
}

/** A pattern that is exactly one lookahead, or exactly one lookbehind. */
const WHOLE_PATTERN_LOOKAHEAD = /^\(\?=([\s\S]*)\)$/
const WHOLE_PATTERN_LOOKBEHIND = /^\(\?<=([\s\S]*)\)$/

/**
 * Compile the two zero-width split idioms — `(?=X)` (split before each X) and
 * `(?<=X)` (split after each X) — onto RE2, which has no lookaround.
 *
 * Neither idiom actually needs lookaround to *split*: splitting on `(?=X)` is
 * slicing at the start of every match of `X`, and on `(?<=X)` at every match
 * end. RE2 can locate both. These two cover the reason a split pattern reaches
 * for lookaround at all — keeping the delimiter attached to the leading or
 * trailing chunk — so they stay on the linear engine instead of forcing a
 * fallback to the backtracking one.
 *
 * Returns `null` unless the whole pattern is a single such assertion whose body
 * RE2 can represent; negative lookaround, lookbehind mixed with other syntax,
 * and backreferences are not covered.
 *
 * `test`/`find` report on the body itself: a zero-width assertion matches
 * exactly when its body does, so `test` is exact, while `find` gives the body's
 * start rather than the (zero-width) assertion position.
 */
export function compileLookaroundSplit(
  pattern: string,
  options: LinearRegexOptions = {}
): LinearRegex | null {
  const ahead = WHOLE_PATTERN_LOOKAHEAD.exec(pattern)?.[1]
  const behind = ahead === undefined ? WHOLE_PATTERN_LOOKBEHIND.exec(pattern)?.[1] : undefined
  const body = ahead ?? behind
  if (!body) return null

  let compiled: ReturnType<typeof RE2JS.compile>
  try {
    compiled = RE2JS.compile(body, options.ignoreCase ? RE2JS.CASE_INSENSITIVE : 0)
  } catch {
    return null
  }
  const sliceAtMatchStart = ahead !== undefined

  return {
    test: (text) => compiled.matcher(text).find(),
    find: (text) => {
      const matcher = compiled.matcher(text)
      return matcher.find() ? matcher.start() : -1
    },
    split: (text) => {
      const segments: string[] = []
      const matcher = compiled.matcher(text)
      let cursor = 0
      while (matcher.find()) {
        const boundary = sliceAtMatchStart ? matcher.start() : matcher.end()
        // Skip a boundary at the cursor or at the very end: both would emit an
        // empty segment, which `String.prototype.split` also produces and every
        // caller discards.
        if (boundary <= cursor || boundary >= text.length) continue
        segments.push(text.slice(cursor, boundary))
        cursor = boundary
      }
      segments.push(text.slice(cursor))
      return segments
    },
  }
}

/**
 * Compile `pattern` into a matcher that cannot backtrack.
 *
 * Returns `null` when RE2 cannot represent the pattern — invalid syntax, or the
 * lookaround and backreference constructs RE2 does not implement. Callers must
 * handle `null` explicitly rather than silently falling back to the built-in
 * engine, which would reintroduce the exposure this exists to remove.
 */
export function compileLinearRegex(
  pattern: string,
  options: LinearRegexOptions = {}
): LinearRegex | null {
  try {
    const compiled = RE2JS.compile(pattern, options.ignoreCase ? RE2JS.CASE_INSENSITIVE : 0)
    return {
      test: (text) => compiled.matcher(text).find(),
      find: (text) => {
        const matcher = compiled.matcher(text)
        return matcher.find() ? matcher.start() : -1
      },
      split: (text) => compiled.split(text),
    }
  } catch {
    return null
  }
}

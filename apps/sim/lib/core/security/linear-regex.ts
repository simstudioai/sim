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
  const flags = options.ignoreCase ? 'gi' : 'g'
  const source = escapeRegExp(pattern)
  const at = (text: string): number => {
    const regex = new RegExp(source, flags)
    const match = regex.exec(text)
    return match ? match.index : -1
  }
  return {
    test: (text) => at(text) >= 0,
    find: at,
    split: (text) => text.split(new RegExp(source, flags)),
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

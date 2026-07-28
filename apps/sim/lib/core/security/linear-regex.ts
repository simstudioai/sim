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
 * RE2 has no backtracking and matches in time linear in the input. Two costs
 * follow, and this module works to keep both off the caller:
 *
 * - **Syntax.** RE2 implements neither lookaround nor backreferences, and
 *   spells some escapes differently. `translateToRe2` bridges the mechanical
 *   differences and `compileLookaroundSplit` recovers the lookaround *split*
 *   idioms; genuine gaps return `null` so each caller decides how to degrade.
 * - **Throughput.** Measured 0.5–270ms per megabyte depending on the pattern,
 *   against roughly 0.04ms/MB for the built-in engine. Callers matching a
 *   pattern with no metacharacter should take `literalRegex` instead.
 */
export interface LinearRegexOptions {
  ignoreCase?: boolean
}

export interface LinearRegex {
  /** Whether the pattern matches anywhere in `text`. */
  test(text: string): boolean
  /** Index of the first match in `text`, or -1. */
  find(text: string): number
  /**
   * Split `text` around every match.
   *
   * Follows `String.prototype.split` except that a trailing empty segment is
   * omitted — RE2 drops it, and every caller here discards empties anyway.
   */
  split(text: string): string[]
}

const METACHARACTERS = /[.*+?^${}()|[\]\\]/

/** Escape every regex metacharacter so `input` matches only itself. */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when `pattern` has no metacharacter, so both engines behave identically. */
export function isPlainText(pattern: string): boolean {
  return !METACHARACTERS.test(pattern)
}

/**
 * ECMAScript's `\s` as an RE2 character-class body.
 *
 * RE2's `\s` is ASCII-only (`[\t\n\f\r ]`), while ECMAScript's also covers
 * `\v`, NBSP, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
 * and U+FEFF. Left untranslated, a `\s`-based document splitter silently stops
 * splitting on the non-breaking spaces that PDF, DOCX and HTML extraction put
 * everywhere — producing different chunks, and so different embeddings, for a
 * document that has not changed. Verified equivalent to ECMAScript `\s` across
 * a full sweep of the BMP.
 */
const JS_WHITESPACE_BODY = '\\t\\n\\v\\f\\r\\x{2028}\\x{2029}\\x{feff}\\p{Zs}'

/**
 * Rewrite the mechanical ECMAScript-vs-RE2 spelling differences.
 *
 * Two substitutions, both verified equivalent:
 * - `\s`/`\S` → the Unicode set above, so whitespace splitting is unchanged.
 * - `\uXXXX` → `\x{XXXX}`, RE2's spelling. Untranslated, RE2 rejects the
 *   pattern outright, which turns the ordinary way of writing a non-ASCII
 *   delimiter (`•`) into a hard failure.
 *
 * Scans with escape and character-class state so `\\s` (a literal backslash
 * followed by `s`) is left alone and `[\s\d]` splices the set body rather than
 * nesting a class. `\S` *inside* a class is left as RE2's ASCII form: negation
 * within a set cannot be spliced, and `[^\S\n]` is rare enough not to justify
 * a full class parser.
 */
function translateToRe2(pattern: string): string {
  let out = ''
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]

    if (char === '\\') {
      const next = pattern[i + 1]
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(pattern.slice(i + 2, i + 6))) {
        out += `\\x{${pattern.slice(i + 2, i + 6)}}`
        i += 5
        continue
      }
      if (next === 's') {
        out += inClass ? JS_WHITESPACE_BODY : `[${JS_WHITESPACE_BODY}]`
        i += 1
        continue
      }
      if (next === 'S' && !inClass) {
        out += `[^${JS_WHITESPACE_BODY}]`
        i += 1
        continue
      }
      out += next === undefined ? char : char + next
      i += 1
      continue
    }

    if (inClass) {
      if (char === ']') inClass = false
    } else if (char === '[') {
      inClass = true
    }
    out += char
  }
  return out
}

/** Index of the `)` closing the group opened at `open`, or -1. */
function closingParen(pattern: string, open: number): number {
  let depth = 0
  let inClass = false
  for (let i = open; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (inClass) {
      if (char === ']') inClass = false
      continue
    }
    if (char === '[') inClass = true
    else if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

interface SplitShape {
  behind: string
  middle: string
  ahead: string
}

/**
 * True when `pattern` has a `|` outside any group or character class.
 *
 * A split shape cannot be decomposed when its middle alternates at the top
 * level: `(?<=\.)\s+|\n\n` means `((?<=\.)\s+)|(\n\n)`, so the assertion binds
 * to the first branch only. Rebuilding it as `(?:\.)(\s+|\n\n)` would require
 * the period before *either* branch — a silently different pattern. No grouping
 * fixes that, so such patterns are rejected rather than reshaped.
 */
function hasTopLevelAlternation(pattern: string): boolean {
  let depth = 0
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (inClass) {
      if (char === ']') inClass = false
      continue
    }
    if (char === '[') inClass = true
    else if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === '|' && depth === 0) return true
  }
  return false
}

/**
 * Decompose a split pattern into `(?<=behind) middle (?=ahead)`, with either
 * assertion optional. Returns `null` when neither is present (the caller should
 * compile normally) or when the shape is anything else.
 */
function parseSplitShape(pattern: string): SplitShape | null {
  let rest = pattern
  let behind = ''

  if (rest.startsWith('(?<=')) {
    const close = closingParen(rest, 0)
    if (close === -1) return null
    behind = rest.slice(4, close)
    rest = rest.slice(close + 1)
  }

  let ahead = ''
  let depth = 0
  let inClass = false
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (inClass) {
      if (char === ']') inClass = false
      continue
    }
    if (char === '[') {
      inClass = true
      continue
    }
    if (char === ')') depth -= 1
    if (char !== '(') continue
    depth += 1
    if (depth !== 1 || !rest.startsWith('(?=', i)) continue
    const close = closingParen(rest, i)
    if (close !== rest.length - 1) continue
    ahead = rest.slice(i + 3, close)
    rest = rest.slice(0, i)
    break
  }

  if (!behind && !ahead) return null
  if (hasTopLevelAlternation(rest)) return null
  return { behind, middle: rest, ahead }
}

/**
 * Compile a lookaround *split* pattern onto RE2, which has no lookaround.
 *
 * Splitting never needs the assertion itself — only the span the delimiter
 * consumes. `(?<=X)Y(?=Z)` becomes `(?:X)(Y)(?:Z)`, and the span of group 1 is
 * exactly what `String.prototype.split` would remove. That covers every
 * combination in one rule: `(?=Z)` alone splits before a delimiter and keeps
 * it, `(?<=X)` alone splits after one, and `(?<=[.!?])\s+(?=[A-Z])` — the
 * sentence splitter — consumes the whitespace between them.
 *
 * Returns `null` for negative lookaround, backreferences, a middle that
 * alternates at the top level, or any body RE2 cannot represent.
 *
 * Two details make the reconstruction faithful rather than approximate. The
 * middle is captured by *name*, so a capturing group inside `behind` cannot
 * shift the index out from under it. And each iteration resumes the search at
 * the end of the previous delimiter rather than at the end of the whole match,
 * so the assertion text is not consumed — without that, every boundary whose
 * lookahead text doubles as the next boundary's lookbehind would be swallowed
 * (`(?<=\w)\s+(?=[A-Z])` over `A B C D` would split only half the gaps).
 *
 * Known divergence: when delimiters themselves overlap — a single-character
 * middle whose matches abut, as in `(?<=\w).(?=\w)` — a match starting behind
 * the cursor is dropped instead of emitting the empty segment the built-in
 * engine would. Splitters that consume whitespace or punctuation between
 * tokens do not overlap and are unaffected.
 */
export function compileLookaroundSplit(
  pattern: string,
  options: LinearRegexOptions = {}
): LinearRegex | null {
  const shape = parseSplitShape(pattern)
  if (!shape) return null

  const behind = shape.behind ? `(?:${shape.behind})` : ''
  const ahead = shape.ahead ? `(?:${shape.ahead})` : ''
  const source = translateToRe2(`${behind}(?P<mid>${shape.middle})${ahead}`)

  let compiled: ReturnType<typeof RE2JS.compile>
  try {
    compiled = RE2JS.compile(source, options.ignoreCase ? RE2JS.CASE_INSENSITIVE : 0)
  } catch {
    return null
  }

  /** Span of the delimiter itself — what `String.prototype.split` removes. */
  const delimiterAt = (text: string, from: number): { start: number; end: number } | null => {
    const matcher = compiled.matcher(text)
    if (!matcher.find(from)) return null
    return { start: matcher.start('mid'), end: matcher.end('mid') }
  }

  return {
    test: (text) => compiled.matcher(text).find(),
    find: (text) => delimiterAt(text, 0)?.start ?? -1,
    split: (text) => {
      const segments: string[] = []
      let cursor = 0
      let searchFrom = 0
      while (searchFrom <= text.length) {
        const span = delimiterAt(text, searchFrom)
        if (!span) break
        // Always advance, so a zero-width delimiter cannot spin.
        searchFrom = span.end > span.start ? span.end : span.start + 1
        // Skip a boundary behind the cursor, or one that would only emit an
        // empty leading or trailing segment.
        if (span.start < cursor || span.start >= text.length) continue
        if (span.start === cursor && span.end === cursor) continue
        segments.push(text.slice(cursor, span.start))
        cursor = span.end
      }
      segments.push(text.slice(cursor))
      return segments
    },
  }
}

/**
 * Match `pattern` as an escaped literal on the built-in engine.
 *
 * Safe because an escaped literal cannot backtrack, and far quicker than RE2 —
 * worth taking whenever the pattern has no metacharacter to interpret, or as a
 * degradation path when RE2 rejects the syntax.
 */
export function literalRegex(pattern: string, options: LinearRegexOptions = {}): LinearRegex {
  const source = escapeRegExp(pattern)
  const caseFlag = options.ignoreCase ? 'i' : ''
  // Non-global, so `exec`/`test` keep no `lastIndex` between calls and one
  // instance is reusable — callers scan line-by-line, and recompiling per line
  // would dominate the cost.
  const scanner = new RegExp(source, caseFlag)
  return {
    test: (text) => scanner.test(text),
    find: (text) => {
      const match = scanner.exec(text)
      return match ? match.index : -1
    },
    // Built lazily: no caller splits on a literal, so the second compile is
    // only paid if one ever does.
    split: (text) => text.split(new RegExp(source, `g${caseFlag}`)),
  }
}

/**
 * Compile `pattern` into a matcher that cannot backtrack.
 *
 * Returns `null` when RE2 cannot represent the pattern — invalid syntax, or
 * constructs RE2 does not implement (lookaround, backreferences, repeat counts
 * above 1000). Callers must handle `null` explicitly rather than silently
 * falling back to the built-in engine, which would reintroduce the exposure
 * this exists to remove.
 */
export function compileLinearRegex(
  pattern: string,
  options: LinearRegexOptions = {}
): LinearRegex | null {
  try {
    const compiled = RE2JS.compile(
      translateToRe2(pattern),
      options.ignoreCase ? RE2JS.CASE_INSENSITIVE : 0
    )
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

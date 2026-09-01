import {
  FILE_SEARCH_PATTERN_LITERAL_CAP,
  FILE_SEARCH_PATTERN_MAX_DEPTH,
  FILE_SEARCH_PATTERN_MAX_REPEAT,
} from '@/lib/workspace-files/search/constants'

/**
 * A pattern the caller can fix. The message is written for the caller — the
 * application use case rethrows it as a `validation` orchestration error, whose
 * text is surfaced verbatim, so it must name the offending construct and the
 * supported alternative.
 */
export class FileSearchPatternError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileSearchPatternError'
  }
}

export interface FileSearchRegexAnalysis {
  /** The pattern in PostgreSQL ARE spelling, for the `~` / `~*` operator. */
  postgresSource: string
  /** Longest run of literal characters that every possible match must contain. */
  longestLiteralRun: number
  /** Every literal character in the pattern, for metacharacter-blind smart case. */
  literals: string
  /** Whether `^` or `$` appears outside a character class. */
  anchored: boolean
}

/**
 * What a sub-pattern guarantees about the literal text of its matches.
 *
 * `exact` is set only when the sub-pattern matches exactly one fixed string,
 * which is what lets a concatenation join literal runs across it. `prefix` and
 * `suffix` are the literal text every match must begin and end with, and `best`
 * is the longest literal run every match must contain somewhere. All three are
 * truncated to {@link FILE_SEARCH_PATTERN_LITERAL_CAP}; a shorter guarantee is
 * still a sound guarantee, and only the first few characters decide the gate.
 */
interface LiteralGuarantee {
  exact: string | null
  prefix: string
  suffix: string
  best: number
  zeroWidth: boolean
}

const EMPTY: LiteralGuarantee = {
  exact: '',
  prefix: '',
  suffix: '',
  best: 0,
  zeroWidth: true,
}

const OPAQUE: LiteralGuarantee = {
  exact: null,
  prefix: '',
  suffix: '',
  best: 0,
  zeroWidth: false,
}

/** Escapes whose meaning and spelling are identical in PostgreSQL ARE and JavaScript. */
const SHARED_ESCAPE_LETTERS = new Set(['d', 'D', 'w', 'W', 's', 'S', 't', 'n', 'r', 'f', 'v'])

/**
 * PostgreSQL-only escapes, rejected so one spelling means one thing in both
 * engines. Only the three with a genuine equivalent name one: `\Y` is a
 * *non*-boundary, and `\m` / `\M` bind to a word edge rather than the line's,
 * so pointing them at `\b` / `^` / `$` would hand back different semantics
 * under the guise of a fix.
 */
const POSTGRES_ONLY_ESCAPES: Record<string, string | null> = {
  y: '\\b',
  Y: null,
  m: null,
  M: null,
  A: '^',
  Z: '$',
}

/**
 * A run is measured in characters, because that is what `pg_trgm` indexes. The
 * parser walks UTF-16 units, so an astral character arrives as two surrogate
 * atoms whose concatenation is one character — counting units would score it two.
 */
function runLength(text: string): number {
  return [...text].length
}

function head(text: string): string {
  return text.length > FILE_SEARCH_PATTERN_LITERAL_CAP
    ? text.slice(0, FILE_SEARCH_PATTERN_LITERAL_CAP)
    : text
}

function tail(text: string): string {
  return text.length > FILE_SEARCH_PATTERN_LITERAL_CAP
    ? text.slice(text.length - FILE_SEARCH_PATTERN_LITERAL_CAP)
    : text
}

function literal(character: string): LiteralGuarantee {
  return {
    exact: character,
    prefix: character,
    suffix: character,
    best: runLength(character),
    zeroWidth: false,
  }
}

/**
 * `left` then `right`. A side with a fixed `exact` string is transparent, so the
 * neighbouring runs join across it — that is what lets `foo(?:)bar` and `^foo`
 * keep the run their spelling implies.
 */
function concatenate(left: LiteralGuarantee, right: LiteralGuarantee): LiteralGuarantee {
  const joined = tail(left.suffix) + head(right.prefix)
  return {
    exact: left.exact !== null && right.exact !== null ? head(left.exact + right.exact) : null,
    prefix: head(left.exact !== null ? left.exact + right.prefix : left.prefix),
    suffix: tail(right.exact !== null ? left.suffix + right.exact : right.suffix),
    best: Math.max(left.best, right.best, runLength(joined)),
    zeroWidth: left.zeroWidth && right.zeroWidth,
  }
}

/**
 * `left` or `right`. Only what both branches guarantee survives, so the run of
 * the weaker branch is the run of the alternation.
 */
function alternate(left: LiteralGuarantee, right: LiteralGuarantee): LiteralGuarantee {
  let prefixLength = 0
  while (
    prefixLength < left.prefix.length &&
    prefixLength < right.prefix.length &&
    left.prefix[prefixLength] === right.prefix[prefixLength]
  ) {
    prefixLength += 1
  }
  let suffixLength = 0
  while (
    suffixLength < left.suffix.length &&
    suffixLength < right.suffix.length &&
    left.suffix[left.suffix.length - 1 - suffixLength] ===
      right.suffix[right.suffix.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }
  return {
    exact: left.exact !== null && left.exact === right.exact ? left.exact : null,
    prefix: left.prefix.slice(0, prefixLength),
    suffix: suffixLength === 0 ? '' : left.suffix.slice(left.suffix.length - suffixLength),
    best: Math.min(left.best, right.best),
    zeroWidth: left.zeroWidth && right.zeroWidth,
  }
}

/**
 * `atom` repeated between `min` and `max` times.
 *
 * An optional atom guarantees nothing. A variable count is not exact, but it
 * still guarantees `min` copies back to back — every match of `(?:ab){2,5}`
 * contains `abab` — so a fixed atom contributes that expansion rather than the
 * single occurrence it would otherwise be scored at. An atom with no fixed
 * string contributes only what one occurrence guarantees, since nothing joins
 * across the repetition: `fo` + `o+` guarantees `foo`, never `foo…o`.
 */
function repeat(atom: LiteralGuarantee, min: number, max: number): LiteralGuarantee {
  if (min === 0) return { ...OPAQUE, zeroWidth: true }
  if (min === max && atom.exact !== null) {
    const total = atom.exact.length * min
    if (total <= FILE_SEARCH_PATTERN_LITERAL_CAP) {
      const expanded = atom.exact.repeat(min)
      return { ...literal(expanded), zeroWidth: expanded.length === 0 }
    }
  }
  if (atom.exact) {
    const copies = Math.min(min, Math.ceil(FILE_SEARCH_PATTERN_LITERAL_CAP / atom.exact.length))
    const expanded = atom.exact.repeat(Math.max(1, copies))
    return {
      exact: null,
      prefix: head(expanded),
      suffix: tail(expanded),
      best: Math.min(FILE_SEARCH_PATTERN_LITERAL_CAP, runLength(atom.exact) * min),
      zeroWidth: false,
    }
  }
  return {
    exact: null,
    prefix: atom.prefix,
    suffix: atom.suffix,
    best: atom.best,
    zeroWidth: atom.zeroWidth,
  }
}

interface Quantifier {
  min: number
  max: number
}

/**
 * Parses the supported regex subset in one pass, computing what every match is
 * guaranteed to contain literally and rewriting the few escapes PostgreSQL
 * spells differently.
 *
 * The subset is deliberately the intersection of PostgreSQL ARE and JavaScript
 * `RegExp`: the same source drives the indexed `~` / `~*` predicate and the
 * client-side match location used to centre a preview, so anything whose meaning
 * differs between the two engines is rejected rather than silently reinterpreted.
 */
class FileSearchRegexParser {
  private index = 0
  private depth = 0
  private readonly literalCharacters: string[] = []
  private readonly wordBoundaryOffsets: number[] = []
  private anchored = false

  constructor(private readonly source: string) {}

  analyze(): FileSearchRegexAnalysis {
    const guarantee = this.parseAlternation()
    if (this.index < this.source.length) {
      throw new FileSearchPatternError(
        `Unbalanced ")" at position ${this.index + 1} in the search pattern`
      )
    }
    return {
      postgresSource: this.toPostgresSource(),
      longestLiteralRun: guarantee.best,
      literals: this.literalCharacters.join(''),
      anchored: this.anchored,
    }
  }

  private toPostgresSource(): string {
    if (this.wordBoundaryOffsets.length === 0) return this.source
    let rewritten = ''
    let cursor = 0
    for (const offset of this.wordBoundaryOffsets) {
      rewritten += `${this.source.slice(cursor, offset)}\\y`
      cursor = offset + 2
    }
    return rewritten + this.source.slice(cursor)
  }

  private peek(): string | undefined {
    return this.source[this.index]
  }

  private parseAlternation(): LiteralGuarantee {
    let guarantee = this.parseConcatenation()
    while (this.peek() === '|') {
      this.index += 1
      guarantee = alternate(guarantee, this.parseConcatenation())
    }
    return guarantee
  }

  private parseConcatenation(): LiteralGuarantee {
    let guarantee = EMPTY
    while (this.index < this.source.length) {
      const character = this.peek()
      if (character === '|' || character === ')') break
      guarantee = concatenate(guarantee, this.parseQuantified())
    }
    return guarantee
  }

  private parseQuantified(): LiteralGuarantee {
    const start = this.index
    const atom = this.parseAtom()
    const quantifier = this.parseQuantifier()
    if (!quantifier) return atom
    if (atom.zeroWidth && atom.exact === '') {
      throw new FileSearchPatternError(
        `Quantifier at position ${start + 1} has no character to repeat in the search pattern`
      )
    }
    if (this.peek() === '?') this.index += 1
    return repeat(atom, quantifier.min, quantifier.max)
  }

  private parseAtom(): LiteralGuarantee {
    const character = this.source[this.index]
    if (character === '*' || character === '+' || character === '?') {
      throw new FileSearchPatternError(
        `Quantifier "${character}" at position ${this.index + 1} has no character to repeat in the search pattern`
      )
    }
    if (character === '(') return this.parseGroup()
    if (character === '[') return this.parseCharacterClass()
    if (character === '\\') return this.parseEscape()
    if (character === '^' || character === '$') {
      this.index += 1
      this.anchored = true
      return EMPTY
    }
    if (character === '.') {
      this.index += 1
      return OPAQUE
    }
    if (character === '{') {
      if (!this.readQuantifierAt(this.index)) {
        throw new FileSearchPatternError(
          `Unescaped "{" at position ${this.index + 1} — write "\\{" to match a literal brace`
        )
      }
      throw new FileSearchPatternError(
        `Quantifier at position ${this.index + 1} has no character to repeat in the search pattern`
      )
    }
    if (character === ')') {
      throw new FileSearchPatternError(
        `Unbalanced ")" at position ${this.index + 1} in the search pattern`
      )
    }
    this.index += 1
    this.literalCharacters.push(character as string)
    return literal(character as string)
  }

  private parseGroup(): LiteralGuarantee {
    const start = this.index
    this.index += 1
    if (this.peek() === '?') {
      const marker = this.source.slice(this.index, this.index + 2)
      if (marker === '?:') {
        this.index += 2
      } else if (marker === '?=' || marker === '?!') {
        throw new FileSearchPatternError(
          `Lookahead "(${marker}" at position ${start + 1} is not supported — the search pattern must match text directly`
        )
      } else if (
        this.source.startsWith('?<=', this.index) ||
        this.source.startsWith('?<!', this.index)
      ) {
        throw new FileSearchPatternError(
          `Lookbehind at position ${start + 1} is not supported — the search pattern must match text directly`
        )
      } else if (this.source.startsWith('?<', this.index)) {
        throw new FileSearchPatternError(
          `Named group at position ${start + 1} is not supported — use "(?:...)" for a non-capturing group`
        )
      } else {
        throw new FileSearchPatternError(
          `Inline flag group at position ${start + 1} is not supported — case sensitivity follows the pattern's own letters`
        )
      }
    }
    this.depth += 1
    if (this.depth > FILE_SEARCH_PATTERN_MAX_DEPTH) {
      throw new FileSearchPatternError(
        `Search pattern nests groups more than ${FILE_SEARCH_PATTERN_MAX_DEPTH} deep`
      )
    }
    const guarantee = this.parseAlternation()
    if (this.peek() !== ')') {
      throw new FileSearchPatternError(
        `Unclosed "(" at position ${start + 1} in the search pattern`
      )
    }
    this.index += 1
    this.depth -= 1
    return guarantee
  }

  private parseCharacterClass(): LiteralGuarantee {
    const start = this.index
    this.index += 1
    if (this.peek() === '^') this.index += 1
    if (this.peek() === ']') this.index += 1
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (character === ']') {
        this.index += 1
        return OPAQUE
      }
      if (character === '[' && this.source[this.index + 1] === ':') {
        throw new FileSearchPatternError(
          `POSIX class at position ${this.index + 1} is not supported — write the range directly, such as "[a-z]" or "\\w"`
        )
      }
      if (character === '\\') {
        this.readClassEscape()
        continue
      }
      this.index += 1
    }
    throw new FileSearchPatternError(`Unclosed "[" at position ${start + 1} in the search pattern`)
  }

  private readClassEscape(): void {
    const next = this.source[this.index + 1]
    if (next === undefined) {
      throw new FileSearchPatternError('Search pattern ends with a trailing backslash')
    }
    if (next === 'b') {
      throw new FileSearchPatternError(
        `"\\b" inside "[...]" at position ${this.index + 1} is not supported — move the word boundary outside the character class`
      )
    }
    this.assertSupportedEscape(next)
    this.index += 2
  }

  private parseEscape(): LiteralGuarantee {
    const start = this.index
    const next = this.source[this.index + 1]
    if (next === undefined) {
      throw new FileSearchPatternError('Search pattern ends with a trailing backslash')
    }
    if (next === 'b') {
      this.index += 2
      this.wordBoundaryOffsets.push(start)
      return EMPTY
    }
    this.assertSupportedEscape(next)
    this.index += 2
    if (SHARED_ESCAPE_LETTERS.has(next)) return OPAQUE
    this.literalCharacters.push(next)
    return literal(next)
  }

  private assertSupportedEscape(next: string): void {
    if (next === 'p' || next === 'P') {
      throw new FileSearchPatternError(
        `"\\${next}{...}" Unicode property escapes are not supported — write the range directly, such as "[a-z]"`
      )
    }
    if (next >= '1' && next <= '9') {
      throw new FileSearchPatternError(
        `Backreference "\\${next}" is not supported — repeat the group's pattern instead`
      )
    }
    if (next in POSTGRES_ONLY_ESCAPES) {
      const equivalent = POSTGRES_ONLY_ESCAPES[next]
      throw new FileSearchPatternError(
        equivalent
          ? `"\\${next}" is not supported — write "${equivalent}" instead`
          : `"\\${next}" is not supported, and no supported escape means the same thing`
      )
    }
    if (SHARED_ESCAPE_LETTERS.has(next)) return
    if (/[\p{L}\p{N}]/u.test(next)) {
      throw new FileSearchPatternError(
        `"\\${next}" is not a supported escape — supported escapes are \\d \\D \\w \\W \\s \\S \\b \\t \\n \\r \\f \\v and any punctuation character`
      )
    }
  }

  /**
   * `{n}`, `{n,}` or `{n,m}` — but only when the braces really do form one. An
   * unmatched `{` is a literal brace in JavaScript and a syntax error in
   * PostgreSQL, so the caller is told to escape it rather than left to discover
   * the divergence.
   */
  private parseQuantifier(): Quantifier | null {
    const character = this.peek()
    if (character === '*') {
      this.index += 1
      return { min: 0, max: Number.POSITIVE_INFINITY }
    }
    if (character === '+') {
      this.index += 1
      return { min: 1, max: Number.POSITIVE_INFINITY }
    }
    if (character === '?') {
      this.index += 1
      return { min: 0, max: 1 }
    }
    if (character !== '{') return null
    const bounded = this.readQuantifierAt(this.index)
    if (!bounded) {
      throw new FileSearchPatternError(
        `Unescaped "{" at position ${this.index + 1} — write "\\{" to match a literal brace`
      )
    }
    /**
     * `{n,}` has no upper bound to cap — it is `+` with a floor, and both engines
     * expand it the same way — so only a stated maximum is measured against the
     * cap. The minimum is always measured, since that is what an expansion
     * actually unrolls.
     */
    if (
      bounded.min > FILE_SEARCH_PATTERN_MAX_REPEAT ||
      (Number.isFinite(bounded.max) && bounded.max > FILE_SEARCH_PATTERN_MAX_REPEAT)
    ) {
      throw new FileSearchPatternError(
        `Repeat count at position ${this.index + 1} exceeds ${FILE_SEARCH_PATTERN_MAX_REPEAT}`
      )
    }
    if (bounded.min > bounded.max) {
      throw new FileSearchPatternError(
        `Repeat range at position ${this.index + 1} counts down instead of up`
      )
    }
    this.index = bounded.end
    return bounded
  }

  private readQuantifierAt(start: number): (Quantifier & { end: number }) | null {
    const match = /^\{(\d+)(,(\d*)?)?\}/.exec(this.source.slice(start))
    if (!match) return null
    const min = Number(match[1])
    const max =
      match[2] === undefined ? min : match[3] ? Number(match[3]) : Number.POSITIVE_INFINITY
    return { min, max, end: start + match[0].length }
  }
}

export function analyzeFileSearchRegex(source: string): FileSearchRegexAnalysis {
  return new FileSearchRegexParser(source).analyze()
}

import { createLogger } from '@sim/logger'
import micromatch from 'micromatch'
import {
  compileLinearRegex,
  isPlainText,
  type LinearRegex,
  literalRegex,
} from '@/lib/core/security/linear-regex'

const logger = createLogger('VfsOperations')

export interface GrepMatch {
  path: string
  line: number
  content: string
}

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count'

export interface GrepOptions {
  maxResults?: number
  outputMode?: GrepOutputMode
  ignoreCase?: boolean
  lineNumbers?: boolean
  context?: number
}

export interface GrepCountEntry {
  path: string
  count: number
}

/**
 * Thrown when a single-file content grep (see `WorkspaceVFS.grepFile`) hits an
 * expected, user-facing condition: the path is not a single workspace file, the
 * file has no searchable text (image/binary), or it exceeds the inline read cap.
 * The grep handler surfaces the message verbatim instead of treating it as an
 * internal failure. Defined here (rather than in `workspace-vfs.ts`) so the
 * handler can reference it without pulling in the VFS module's heavy deps.
 */
export class WorkspaceFileGrepError extends Error {
  readonly code = 'WORKSPACE_FILE_GREP' as const
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceFileGrepError'
  }
}

/**
 * True when file content is one of `readFileRecord`'s non-text placeholders
 * (binary, unparseable, or over the inline read cap) — these carry no searchable
 * content, so grepping them should report the placeholder instead.
 */
function isNonGreppablePlaceholder(content: string, totalLines: number): boolean {
  if (totalLines !== 1) return false
  return /^\[(File too large|Image too large|Document too large|Could not parse|Binary file|Compiled artifact too large)/.test(
    content.trim()
  )
}

/**
 * Run a single-file content grep over an already-resolved file read result,
 * shared by workspace-file grep (`WorkspaceVFS.grepFile`) and chat-upload grep.
 * Throws {@link WorkspaceFileGrepError} when the file has no searchable text
 * (image/binary attachment) or is a size/parse placeholder; otherwise greps the
 * text with the standard {@link grep} engine over a one-entry map keyed by
 * `path`. `readHint` is the path to suggest in the "use read(...)" message.
 */
export function grepReadResult(
  path: string,
  result: { content: string; totalLines: number; attachment?: unknown },
  pattern: string,
  readHint: string,
  options?: GrepOptions
): GrepMatch[] | string[] | GrepCountEntry[] {
  if (result.attachment) {
    throw new WorkspaceFileGrepError(
      `Cannot grep "${path}" — it has no searchable text (image/binary). Use read("${readHint}") to view it.`
    )
  }
  if (isNonGreppablePlaceholder(result.content, result.totalLines)) {
    throw new WorkspaceFileGrepError(result.content)
  }
  return grep(new Map([[path, result.content]]), pattern, undefined, options)
}

export interface ReadResult {
  content: string
  totalLines: number
}

/**
 * Micromatch options tuned to match the prior in-house glob: `bash: false` so a single `*`
 * never crosses path slashes (required for `files` + star + `meta.json` style paths). `nobrace`
 * and `noext` disable brace and extglob expansion like the old builder. Uses `micromatch` for
 * well-tested `**` and edge cases instead of a custom `RegExp`.
 *
 * Only `micromatch.makeRe` is used — never `micromatch.isMatch`. See {@link compileGlobMatcher}.
 *
 * Exported so the differential test compiles against the production options rather than a
 * copy that can drift out of sync with them.
 */
export const VFS_GLOB_OPTIONS: micromatch.Options = {
  bash: false,
  dot: false,
  windows: false,
  nobrace: true,
  noext: true,
}

/**
 * Longest glob pattern accepted. Every real VFS pattern is a path shape well under this;
 * the cap only exists so a pathological pattern cannot reach the compiler at all.
 */
const MAX_GLOB_PATTERN_LENGTH = 1000

/**
 * Most `*`/`?` wildcards accepted in one pattern. A path-shaped glob uses a handful;
 * dozens only appear in a probe. Bounded independently of length because the ReDoS
 * shapes are short (`*a*a*a…b` is 25 characters).
 */
const MAX_GLOB_WILDCARDS = 32

/**
 * Markers inserted at the start of a path segment while a pattern is matched.
 *
 * `dot: false` and picomatch's "a star must leave something to match" rule are encoded as
 * lookaheads RE2 cannot express. Every one of them constrains the *shape of the segment* the
 * pattern is about to match, so marking each segment start turns the assertion into a character
 * exclusion: a guarded pattern position omits the marker from the class it may consume, an
 * unguarded one consumes it optionally. U+E000–U+E002 are private-use, so a real VFS path
 * cannot contain one; a path that does is not matched.
 *
 * - {@link SEG_DOT} — the segment starts with `.` and is neither `.` nor `..` (`(?!\.)`).
 * - {@link SEG_DOT_ONLY} — the segment is `.` or `..` (`(?!\.{0,1}(?:\/|$))`, plus `(?!\.)`).
 * - {@link SEG_NEWLINE} — the segment starts with a line terminator (`(?=.)`).
 */
const SEG_DOT = '\u{E000}'
const SEG_DOT_ONLY = '\u{E001}'
const SEG_NEWLINE = '\u{E002}'

/** The markers as RE2 escapes, for use inside generated pattern source. */
const SEG_DOT_RE = '\\x{e000}'
const SEG_DOT_ONLY_RE = '\\x{e001}'
const SEG_NEWLINE_RE = '\\x{e002}'
const ALL_MARKERS_RE = `${SEG_DOT_RE}${SEG_DOT_ONLY_RE}${SEG_NEWLINE_RE}`

/**
 * Where surrogate code units are remapped so RE2 sees one code point per UTF-16 code unit.
 *
 * picomatch compiles `?` to `[^/]` and runs it on a `RegExp` with no `u` flag, so it consumes
 * exactly one code unit and an astral character (two units) does not match it. RE2 always
 * matches whole code points, so the same class consumed `😀` and `glob('?')` returned files
 * micromatch excludes — an over-match, and the dangerous direction for a scope filter.
 *
 * Splitting each surrogate half onto its own private-use code point restores UTF-16 counting
 * exactly: `?` matches one half and so cannot match `😀`, while `??` matches both and does,
 * which is what micromatch answers in each case. The alternative — rejecting astral input —
 * would trade an over-match for an under-match on real filenames, so it is not taken. The
 * range is 2048 wide (one per surrogate) and disjoint from the segment markers above.
 */
const SURROGATE_ESCAPE_BASE = 0xe800

/** Any surrogate code unit, paired or lone. Deliberately not `u`-flagged. */
const SURROGATE_CHAR = /[\uD800-\uDFFF]/

/**
 * Code points the translation reserves for its own use — the segment markers and the surrogate
 * escape range — so a pattern or path already containing one is rejected rather than confused
 * with a marker or with half of an astral character.
 */
const RESERVED_CHAR = /[\u{E000}-\u{E002}\u{E800}-\u{EFFF}]/u

/** The bounds of {@link RESERVED_CHAR}, for rejecting a class range that spans them. */
const RESERVED_FIRST = 0xe000
const RESERVED_LAST = 0xefff

/**
 * Escapes picomatch never emits — it escapes only punctuation. A `\` before a word character
 * is therefore caller text passed through verbatim, and RE2 reads several of those as
 * something ECMAScript does not: `\A` and `\z` are zero-width anchors rather than literals,
 * and `\p{…}` is a Unicode class that would consume a segment marker.
 */
const WORD_ESCAPE = /[A-Za-z0-9]/

/** Rewrite every surrogate code unit to its {@link SURROGATE_ESCAPE_BASE} counterpart. */
function escapeSurrogates(text: string): string {
  if (!SURROGATE_CHAR.test(text)) return text
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out +=
      code >= 0xd800 && code <= 0xdfff
        ? String.fromCharCode(SURROGATE_ESCAPE_BASE + (code - 0xd800))
        : text[i]
  }
  return out
}

/**
 * {@link escapeSurrogates} over generated pattern source, or `null` when a surrogate sits
 * inside a character class. Remapping there would move a range endpoint above the segment
 * markers, so `[a-😀]` would start consuming them; the shape is degenerate enough that failing
 * closed costs nothing.
 */
function escapeSurrogatesInSource(source: string): string | null {
  if (!SURROGATE_CHAR.test(source)) return source
  let out = ''
  let inClass = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    const code = source.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdfff) {
      if (inClass) return null
      out += String.fromCharCode(SURROGATE_ESCAPE_BASE + (code - 0xd800))
      continue
    }
    if (char === '\\') {
      const next = source[i + 1]
      if (next === undefined) return null
      // picomatch escapes each surrogate half individually; `\` before one is decorative, and
      // the remapped code point is not a metacharacter, so the escape is dropped rather than
      // handed to RE2 as an unknown one.
      if (SURROGATE_CHAR.test(next)) {
        if (inClass) return null
        out += String.fromCharCode(SURROGATE_ESCAPE_BASE + (source.charCodeAt(i + 1) - 0xd800))
        i += 1
        continue
      }
      out += char + next
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

/** The code points ECMAScript's `.` excludes, as a matcher and as RE2 escapes. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/
const NEWLINE_RE = '\\x{a}\\x{d}\\x{2028}\\x{2029}'

/** Picomatch's `**` body: any run of characters that does not open a dot segment. */
const GLOBSTAR_BODY = '(?:(?:(?!(?:^|\\/)\\.).)*?)'
const GLOBSTAR_CLASS = `[^${ALL_MARKERS_RE}${NEWLINE_RE}]`

/** The three assertion shapes picomatch emits under {@link VFS_GLOB_OPTIONS}. */
const DOT_GUARD = '(?!\\.)'
const NON_EMPTY_GUARD = '(?=.)'
const DOT_SEGMENT_GUARD = '(?!\\.{0,1}(?:\\/|$))'

export interface GlobMatcher {
  matches(path: string): boolean
}

/**
 * Thrown when a caller-supplied glob pattern is outside the safety caps. Both the `glob`
 * and `grep` tool handlers already turn a thrown error into `{ success: false, error }`,
 * so the message reaches the caller verbatim.
 */
export class GlobPatternError extends Error {
  readonly code = 'GLOB_PATTERN' as const
  constructor(message: string) {
    super(message)
    this.name = 'GlobPatternError'
  }
}

/**
 * Compiled matchers, keyed by pattern. `grep` tests one scope against every file in the VFS
 * and RE2 compilation costs far more than a match, so a pattern must not recompile per file.
 * Cleared wholesale past the cap — patterns arrive in per-request bursts, so eviction order
 * does not matter.
 */
const globMatcherCache = new Map<string, GlobMatcher | null>()

/** Entries kept in {@link globMatcherCache} before it is cleared. */
const GLOB_MATCHER_CACHE_LIMIT = 256

/** {@link compileGlobMatcher}, memoized. Throws {@link GlobPatternError} the same way. */
function getGlobMatcher(pattern: string): GlobMatcher | null {
  const cached = globMatcherCache.get(pattern)
  if (cached !== undefined) return cached

  const matcher = compileGlobMatcher(pattern)
  if (globMatcherCache.size >= GLOB_MATCHER_CACHE_LIMIT) globMatcherCache.clear()
  globMatcherCache.set(pattern, matcher)
  return matcher
}

/** Index just past the character class starting at `at`, or -1 when it is unterminated. */
function classEnd(source: string, at: number): number {
  let i = at + 1
  if (source[i] === '^') i += 1
  if (source[i] === ']') i += 1
  while (i < source.length && source[i] !== ']') {
    if (source[i] === '\\') i += 1
    i += 1
  }
  return i < source.length ? i + 1 : -1
}

/**
 * True when a character-class body can be handed to RE2 unchanged.
 *
 * Two shapes cannot. A `\<word char>` escape is caller passthrough RE2 reinterprets (see
 * {@link WORD_ESCAPE}). A range whose endpoints bracket the reserved block lets the class
 * consume a segment marker or half a remapped astral character, which shifts every later
 * atom one position left — `[\u{2000}-\u{F000}].env` would match `.env` by eating its
 * {@link SEG_DOT}, bypassing `dot: false` entirely.
 */
function classBodyIsRepresentable(body: string): boolean {
  let previous = -1
  let i = 0
  while (i < body.length) {
    if (body[i] === '-' && previous >= 0 && i + 1 < body.length) {
      i += 1
      let high: number
      if (body[i] === '\\') {
        const next = body[i + 1]
        if (next === undefined || WORD_ESCAPE.test(next)) return false
        high = next.charCodeAt(0)
        i += 2
      } else {
        high = body.charCodeAt(i)
        i += 1
      }
      if (previous <= RESERVED_LAST && high >= RESERVED_FIRST) return false
      previous = -1
      continue
    }
    if (body[i] === '\\') {
      const next = body[i + 1]
      if (next === undefined || WORD_ESCAPE.test(next)) return false
      previous = next.charCodeAt(0)
      i += 2
      continue
    }
    previous = body.charCodeAt(i)
    i += 1
  }
  return true
}

/** Index of the `)` closing the group opened at `at`, or -1. */
function groupEnd(source: string, at: number): number {
  let depth = 0
  for (let i = at; i < source.length; i++) {
    const char = source[i]
    if (char === '\\') {
      i += 1
    } else if (char === '[') {
      const end = classEnd(source, i)
      if (end === -1) return -1
      i = end - 1
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** The quantifier at `at`, or `''` when there is none (`{ts,tsx}` is a literal, not a repeat). */
function readQuantifier(source: string, at: number): string {
  const char = source[at]
  if (char === '?' || char === '*' || char === '+') {
    return source[at + 1] === '?' ? source.slice(at, at + 2) : char
  }
  if (char === '{') {
    const end = source.indexOf('}', at)
    if (end !== -1 && /^\{\d+(?:,\d*)?\}$/.test(source.slice(at, end + 1))) {
      return source.slice(at, end + 1)
    }
  }
  return ''
}

/**
 * True when a `{n,m}` bound is zero-padded. RE2 reads `a{00}` as the literal text `a{00}`
 * where ECMAScript reads a repeat, so the two engines cannot be reconciled and the source is
 * refused rather than emitted with a silently different meaning.
 */
function hasPaddedBound(quantifier: string): boolean {
  return /^\{0\d|,0\d/.test(quantifier)
}

/** True when `quantifier` lets the atom it follows match nothing. */
function isOptionalQuantifier(quantifier: string): boolean {
  if (quantifier.startsWith('?') || quantifier.startsWith('*')) return true
  const bounded = /^\{(\d+)(?:,\d*)?\}$/.exec(quantifier)
  return bounded !== null && Number(bounded[1]) === 0
}

/** True when every match of the balanced token run `[start, end)` consumes at least one character. */
function sequenceMustConsume(source: string, start: number, end: number): boolean {
  let i = start
  while (i < end) {
    const char = source[i]
    if (char === '^' || char === '$') {
      i += 1
      continue
    }
    let atomEnd: number
    let consumes: boolean
    if (char === '(') {
      const close = groupEnd(source, i)
      if (close === -1 || close >= end) return false
      consumes = groupMustConsume(source, i, close)
      atomEnd = close + 1
    } else if (char === '[') {
      const close = classEnd(source, i)
      if (close === -1) return false
      consumes = true
      atomEnd = close
    } else {
      consumes = true
      atomEnd = char === '\\' ? i + 2 : i + 1
    }
    const quantifier = readQuantifier(source, atomEnd)
    if (consumes && !isOptionalQuantifier(quantifier)) return true
    i = atomEnd + quantifier.length
  }
  return false
}

/** {@link sequenceMustConsume} for a group, which consumes only when every branch does. */
function groupMustConsume(source: string, open: number, close: number): boolean {
  const isNonCapturing = source.startsWith('(?:', open)
  if (!isNonCapturing && source[open + 1] === '?') return false
  let depth = 0
  let from = open + (isNonCapturing ? 3 : 1)
  for (let i = from; i < close; i++) {
    const char = source[i]
    if (char === '\\') {
      i += 1
    } else if (char === '[') {
      const end = classEnd(source, i)
      if (end === -1) return false
      i = end - 1
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
    } else if (char === '|' && depth === 0) {
      if (!sequenceMustConsume(source, from, i)) return false
      from = i + 1
    }
  }
  return sequenceMustConsume(source, from, close)
}

/** Index of the `)` closing the group `from` sits inside, or -1. */
function enclosingGroupEnd(source: string, from: number): number {
  let depth = 0
  for (let i = from; i < source.length; i++) {
    const char = source[i]
    if (char === '\\') {
      i += 1
    } else if (char === '[') {
      const end = classEnd(source, i)
      if (end === -1) return -1
      i = end - 1
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      if (depth === 0) return i
      depth -= 1
    }
  }
  return -1
}

/**
 * True when whatever remains of `source` from `at` must consume at least one character.
 *
 * This is what makes `(?=.)`'s "not at end of input" half droppable: if the rest of the pattern
 * cannot match nothing, the assertion is already implied. Alternatives to the right of a `|`
 * belong to the enclosing group rather than to this position, so they are skipped.
 */
function remainderMustConsume(source: string, at: number): boolean {
  let i = at
  while (i < source.length) {
    const char = source[i]
    if (char === '^' || char === '$') {
      i += 1
      continue
    }
    if (char === ')') {
      i += 1 + readQuantifier(source, i + 1).length
      continue
    }
    if (char === '|') {
      const close = enclosingGroupEnd(source, i)
      if (close === -1) return false
      i = close + 1 + readQuantifier(source, close + 1).length
      continue
    }
    let atomEnd: number
    let consumes: boolean
    if (char === '(') {
      const close = groupEnd(source, i)
      if (close === -1) return false
      consumes = groupMustConsume(source, i, close)
      atomEnd = close + 1
    } else if (char === '[') {
      const close = classEnd(source, i)
      if (close === -1) return false
      consumes = true
      atomEnd = close
    } else {
      consumes = true
      atomEnd = char === '\\' ? i + 2 : i + 1
    }
    const quantifier = readQuantifier(source, atomEnd)
    if (consumes && !isOptionalQuantifier(quantifier)) return true
    i = atomEnd + quantifier.length
  }
  return false
}

/**
 * True when `at` opens a group other than `**`. A guard sitting there applies only to the
 * branches that consume nothing, which no single emitted position can express, so callers
 * fail closed instead.
 */
function isGroupOpen(source: string, at: number): boolean {
  if (source[at] !== '(' || source.startsWith('(?=', at) || source.startsWith('(?!', at))
    return false
  return !source.startsWith(GLOBSTAR_BODY, at)
}

/** `atom` with line terminators removed from what it can match, or `null` when it cannot be. */
function withoutLineTerminators(atom: string): string | null {
  if (atom.startsWith('[^')) return `[^${atom.slice(2, -1)}${NEWLINE_RE}]`
  return LINE_TERMINATOR.test(atom) ? null : atom
}

/**
 * Whether the atom at `at` can match a line terminator. Conservative: a negated class or a
 * group answers "yes", so a `(?=.)` whose non-emptiness would have to be pushed onto such an
 * atom fails closed rather than being approximated.
 */
function atomMayMatchLineTerminator(source: string, at: number): boolean {
  const char = source[at]
  if (char === undefined || char === '(' || char === ')' || char === '|') return true
  if (char === '\\') return LINE_TERMINATOR.test(source[at + 1] ?? '\n')
  if (char === '[') {
    const end = classEnd(source, at)
    if (end === -1) return true
    return source[at + 1] === '^' || LINE_TERMINATOR.test(source.slice(at, end))
  }
  return LINE_TERMINATOR.test(char)
}

/**
 * Rewrite picomatch's generated source into an RE2-representable equivalent.
 *
 * The scan is structural rather than textual: it tracks whether the current output position
 * starts a path segment (following alternation branches and quantified groups, so `(?:X\/)?`
 * is recognised as a boundary), and opens one optional marker class per segment. Each assertion
 * then narrows that class instead of being deleted — `(?!\.)` drops {@link SEG_DOT} and
 * {@link SEG_DOT_ONLY}, `(?!\.{0,1}(?:\/|$))` drops {@link SEG_DOT_ONLY}, `(?=.)` drops
 * {@link SEG_NEWLINE}. `(?=.)` additionally forbids matching nothing at all, which is dropped
 * when the rest of the pattern must consume a character and is otherwise folded into the
 * trailing `[^/]*?\/?$` it guards.
 *
 * Returns `null` when any assertion survives or a shape is unrecognised, which is how a
 * picomatch version emitting something new degrades to "no matches" instead of to the
 * backtracking engine. `operations.glob-semantics.test.ts` pins the equivalence over the grid.
 */
function rewriteGlobSource(generated: string): string | null {
  if (RESERVED_CHAR.test(generated)) return null
  const source = escapeSurrogatesInSource(generated)
  if (source === null) return null

  const parts: string[] = []
  const groups: Array<{
    startBoundary: boolean
    branchEnds: boolean[]
    /** Index in `parts` just past the group opener, so a slot inside it can be recognised. */
    openIndex: number
    /** Index in `source` of the `(`. */
    sourceOpen: number
  }> = []
  let boundary = false
  let emptyBoundary = false
  let slot = -1
  let markers = ''
  let leadingDot = false
  let slotPending = false
  let afterEndAnchor = false
  let nonEmpty = false
  let nonEmptyNeedsNewlineGuard = false
  let i = 0

  const writeSlot = () => {
    if (slot >= 0) parts[slot] = markers === '' ? '' : `[${markers}]?`
  }
  const openSlot = () => {
    if (slot >= 0) return
    slot = parts.length
    markers = ALL_MARKERS_RE
    slotPending = true
    parts.push('')
    writeSlot()
  }
  const dropMarker = (marker: string) => {
    markers = markers.split(marker).join('')
    writeSlot()
  }
  const endSegment = () => {
    slot = -1
    markers = ''
    leadingDot = false
    slotPending = false
  }

  while (i < source.length) {
    // A branch ending in `$` cannot continue, so it never constrains the boundary after it.
    const endsBranch = afterEndAnchor
    afterEndAnchor = false

    if (source.startsWith(GLOBSTAR_BODY, i)) {
      if (nonEmpty) return null
      // `**` never consumes a marker itself, so it is split. Having matched something it can
      // only have stopped before a newline segment — a `/` followed by a dot is exactly what
      // its own guard forbids. Having matched nothing it leaves the position untouched, so the
      // empty branch carries the marker slot forward for whatever follows to narrow.
      const inherited = slotPending ? markers : boundary || emptyBoundary ? ALL_MARKERS_RE : ''
      if (slotPending) parts[slot] = ''
      parts.push(`(?:${GLOBSTAR_CLASS}+[${SEG_NEWLINE_RE}]?|`)
      slot = parts.length
      markers = inherited
      slotPending = true
      parts.push('')
      writeSlot()
      parts.push(')')
      i += GLOBSTAR_BODY.length
      boundary = false
      emptyBoundary = false
      leadingDot = false
      continue
    }

    if (source.startsWith(DOT_GUARD, i)) {
      if (isGroupOpen(source, i + DOT_GUARD.length)) return null
      if (!boundary && !slotPending) return null
      openSlot()
      dropMarker(SEG_DOT_RE)
      dropMarker(SEG_DOT_ONLY_RE)
      i += DOT_GUARD.length
      continue
    }

    if (source.startsWith(DOT_SEGMENT_GUARD, i)) {
      if (!leadingDot) return null
      dropMarker(SEG_DOT_ONLY_RE)
      i += DOT_SEGMENT_GUARD.length
      continue
    }

    if (source.startsWith(NON_EMPTY_GUARD, i)) {
      if (isGroupOpen(source, i + NON_EMPTY_GUARD.length)) return null
      if (boundary || slotPending) {
        openSlot()
        dropMarker(SEG_NEWLINE_RE)
        nonEmptyNeedsNewlineGuard = false
      } else if (leadingDot) {
        // Mid-segment: no marker covers this position, so the guard has to reach the atom.
        nonEmptyNeedsNewlineGuard = true
      } else {
        return null
      }
      nonEmpty = true
      i += NON_EMPTY_GUARD.length
      continue
    }

    const char = source[i]

    if (char === '(') {
      const opener = source.startsWith('(?:', i) ? '(?:' : '('
      if (opener === '(' && source[i + 1] === '?') return null
      parts.push(opener)
      groups.push({
        startBoundary: boundary,
        branchEnds: [],
        openIndex: parts.length,
        sourceOpen: i,
      })
      i += opener.length
      continue
    }

    if (char === '|') {
      const frame = groups[groups.length - 1]
      if (!frame) return null
      frame.branchEnds.push(endsBranch || boundary)
      boundary = frame.startBoundary
      emptyBoundary = false
      // A slot belongs to the branch that emitted it; the next branch is a separate path
      // through the regex and opens its own, so nothing is carried across the `|`.
      endSegment()
      parts.push('|')
      i += 1
      continue
    }

    if (char === ')') {
      const frame = groups.pop()
      if (!frame) return null
      // A slot still pending at the close is un-consumed and goes on serving the position
      // after the group (a trailing `**` leaves exactly this). One the branch already built
      // on is trapped inside it, and nothing outside may narrow it further.
      const carriedSlot = slotPending
      if (!carriedSlot && slot >= frame.openIndex) endSegment()
      const closeIndex = i
      parts.push(')')
      i += 1
      const quantifier = readQuantifier(source, i)
      if (quantifier) {
        if (hasPaddedBound(quantifier)) return null
        parts.push(quantifier)
        i += quantifier.length
      }
      let closedAtBoundary = endsBranch || boundary
      for (const end of frame.branchEnds) closedAtBoundary &&= end
      if (isOptionalQuantifier(quantifier)) closedAtBoundary &&= frame.startBoundary
      boundary = closedAtBoundary
      // A group that can match nothing leaves the position exactly where it started, so on
      // that path the segment marker is still unconsumed and something after the group has to
      // be able to take it — otherwise `(a|b)?*` cannot match `.hidden` at all. The flag is
      // kept apart from `boundary` because the group's other paths are NOT at a segment start,
      // so an assertion landing here would hold for only some of them; every assertion keys on
      // `boundary` and therefore fails closed.
      emptyBoundary =
        !boundary &&
        !carriedSlot &&
        frame.startBoundary &&
        (isOptionalQuantifier(quantifier) ||
          !groupMustConsume(source, frame.sourceOpen, closeIndex))
      continue
    }

    if (char === '^' || char === '$') {
      if (char === '^' && slotPending) {
        // picomatch wraps its output in a redundant `^(?:^…)$)$`, so a slot opened at the
        // outer boundary can land in front of the inner anchor, where no marker can ever
        // reach it. Nothing between the two consumes, so the slot simply moves behind it.
        parts[slot] = ''
        parts.push('^')
        slot = parts.length
        parts.push('')
        writeSlot()
      } else {
        parts.push(char)
      }
      if (char === '^') {
        boundary = true
        emptyBoundary = false
      }
      afterEndAnchor = char === '$'
      i += 1
      continue
    }

    let atom: string
    let atomEnd: number
    let isSlash = false
    if (char === '\\') {
      const next = source[i + 1]
      if (next === undefined || WORD_ESCAPE.test(next)) return null
      atom = `\\${next}`
      atomEnd = i + 2
      isSlash = next === '/'
    } else if (char === '[') {
      const end = classEnd(source, i)
      if (end === -1) return null
      const negated = source[i + 1] === '^'
      const body = source.slice(negated ? i + 2 : i + 1, end - 1)
      if (!classBodyIsRepresentable(body)) return null
      atom = negated ? `[^${body}${ALL_MARKERS_RE}]` : `[${body}]`
      atomEnd = end
    } else if (char === '.') {
      atom = GLOBSTAR_CLASS
      atomEnd = i + 1
    } else if (char === '*' || char === '+' || char === '?') {
      return null
    } else {
      atom = char
      atomEnd = i + 1
      isSlash = char === '/'
    }

    const quantifier = readQuantifier(source, atomEnd)
    if (hasPaddedBound(quantifier)) return null
    const optional = isOptionalQuantifier(quantifier)
    const atBoundary = boundary
    // A class picomatch did not exclude `/` from (its POSIX expansions, and the `.` those
    // sometimes leave behind) can step into the next segment, landing on that segment's marker.
    const crossesSegments = atom.startsWith('[^')
      ? !atom.slice(2, -1).includes('/')
      : atom.startsWith('[')
        ? atom.slice(1, -1).includes('/')
        : false
    if (crossesSegments && quantifier !== '' && quantifier !== '?') return null

    if (nonEmpty) {
      if (!optional) {
        if (nonEmptyNeedsNewlineGuard) {
          const guarded = withoutLineTerminators(atom)
          if (guarded === null) return null
          atom = guarded
        }
      } else {
        if (char !== '[' || crossesSegments) return null
        const rest = source.slice(atomEnd + quantifier.length)
        const first = nonEmptyNeedsNewlineGuard ? withoutLineTerminators(atom) : atom
        if (first === null) return null
        if (remainderMustConsume(source, atomEnd + quantifier.length)) {
          // Only the "not at end of input" half was load-bearing, and the remainder implies it.
          if (nonEmptyNeedsNewlineGuard) {
            if (atomMayMatchLineTerminator(source, atomEnd + quantifier.length)) return null
            if (boundary) openSlot()
            parts.push(`(?:${first}${atom}*?)?`)
          } else {
            if (boundary) openSlot()
            parts.push(`${atom}${quantifier}`)
          }
        } else {
          const tail = /^(\\\/\?)?(\)*)\$$/.exec(rest)
          if (!tail) return null
          if (boundary) openSlot()
          parts.push(tail[1] ? `(?:${first}${atom}*\\/?|\\/)` : `${first}${atom}*`)
          parts.push(`${tail[2]}$`)
          const out = parts.join('')
          return /\(\?[=!<]/.test(out) ? null : out
        }
        nonEmpty = false
        nonEmptyNeedsNewlineGuard = false
        i = atomEnd + quantifier.length
        slotPending = false
        boundary = false
        leadingDot = false
        continue
      }
      nonEmpty = false
      nonEmptyNeedsNewlineGuard = false
    }

    if (boundary || emptyBoundary) openSlot()
    if (crossesSegments) {
      const stepped = `${atom}[${ALL_MARKERS_RE}]?`
      parts.push(quantifier === '?' ? `(?:${stepped})?` : stepped)
    } else {
      parts.push(atom + quantifier)
    }
    i = atomEnd + quantifier.length
    slotPending = false
    emptyBoundary = false
    boundary = isSlash && !optional
    leadingDot = atBoundary && atom === '\\.' && !optional
    if (boundary) endSegment()
  }

  if (groups.length > 0 || nonEmpty) return null
  const out = parts.join('')
  return /\(\?[=!<]/.test(out) ? null : out
}

/**
 * Prefix every path segment with the marker describing its shape, with surrogate halves
 * remapped so RE2 counts UTF-16 code units the way picomatch does. Returns `null` when the
 * path already contains a reserved code point. See {@link SEG_DOT} and
 * {@link SURROGATE_ESCAPE_BASE}.
 */
function markPathSegments(path: string): string | null {
  if (RESERVED_CHAR.test(path)) return null
  const escaped = escapeSurrogates(path)
  if (!escaped.includes('.') && !LINE_TERMINATOR.test(escaped)) return escaped
  return escaped
    .split('/')
    .map((segment) => {
      if (segment === '.' || segment === '..') return SEG_DOT_ONLY + segment
      if (segment.startsWith('.')) return SEG_DOT + segment
      if (segment !== '' && LINE_TERMINATOR.test(segment[0])) return SEG_NEWLINE + segment
      return segment
    })
    .join('/')
}

/**
 * The inner regex of picomatch's negation wrapper `^(?!^(?:X)$).*$` as a standalone
 * `^(?:X)$`, or `null` when `source` is not one.
 *
 * A `!`-prefixed glob is a documented micromatch feature, and the wrapper's lookahead is the
 * one shape RE2 cannot take. Reading the inner pattern off the generated source rather than
 * off the pattern text inherits picomatch's own `!` rules exactly — leading position only,
 * `!!` cancelling, `!(` not counting — instead of restating them here.
 */
function negatedInnerSource(source: string): string | null {
  const prefix = '^(?!^(?:'
  const suffix = ')$).*$'
  if (source.length < prefix.length + suffix.length) return null
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return null
  return groupEnd(source, 1) === source.length - 4 ? source.slice(4, source.length - 4) : null
}

/**
 * Compile a caller-supplied glob into a matcher that cannot backtrack.
 *
 * `micromatch.isMatch` compiles each `*` to `[^/]*?` and runs it on the backtracking engine,
 * so a short pattern like `*a` repeated over a longer path is exponential — and both pattern
 * and paths come from an authenticated caller's tool call.
 *
 * The regex is picomatch's own from `makeRe`, rewritten by {@link rewriteGlobSource}, so the
 * semantics of {@link VFS_GLOB_OPTIONS} are unchanged. Returns `null` when the pattern is not
 * RE2-representable; callers treat that as "matches nothing" rather than falling back to the
 * backtracking engine. Throws {@link GlobPatternError} when the pattern is over the safety caps.
 */
export function compileGlobMatcher(pattern: string): GlobMatcher | null {
  if (pattern.length > MAX_GLOB_PATTERN_LENGTH) {
    throw new GlobPatternError(
      `Glob pattern is too long (${pattern.length} characters, limit ${MAX_GLOB_PATTERN_LENGTH}).`
    )
  }

  const wildcards = pattern.replace(/[^*?]/g, '').length
  if (wildcards > MAX_GLOB_WILDCARDS) {
    throw new GlobPatternError(
      `Glob pattern has too many wildcards (${wildcards}, limit ${MAX_GLOB_WILDCARDS}). ` +
        'Narrow the pattern with literal path segments.'
    )
  }

  let generated: RegExp
  try {
    generated = micromatch.makeRe(pattern, VFS_GLOB_OPTIONS)
  } catch {
    logger.warn('Glob pattern could not be parsed; matching nothing', { pattern })
    return null
  }

  const negatedBody = negatedInnerSource(generated.source)
  const source = rewriteGlobSource(negatedBody ?? generated.source)
  const linear = source === null ? null : compileLinearRegex(source)
  if (!linear) {
    logger.warn('Glob pattern is not RE2-representable; matching nothing', { pattern })
    return null
  }

  return {
    matches: (path: string) => {
      // Micromatch rejects an empty path before its regex ever runs, and picomatch reports an
      // exact string equality as a match even when its own regex would not — `+(a)` against
      // `+(a)` with `noext`. Both are kept so behaviour is unchanged.
      if (path === '') return false
      if (path === pattern) return true
      // A negated pattern's wrapper ends in `.*$`, which under no `s` flag also requires the
      // whole path to be free of line terminators.
      if (negatedBody !== null && LINE_TERMINATOR.test(path)) return false
      const marked = markPathSegments(path)
      if (marked === null) return false
      return negatedBody !== null ? !linear.test(marked) : linear.test(marked)
    },
  }
}

/**
 * Splits VFS text into lines for line-oriented grep. Strips a trailing CR so Windows-style
 * CRLF payloads still match patterns anchored at line end (`$`).
 */
function splitLinesForGrep(content: string): string[] {
  return content.split('\n').map((line) => line.replace(/\r$/, ''))
}

/**
 * Returns true when `filePath` is `scope` or a descendant path (`scope/...`). If `scope` contains
 * `*` or `?`, filters with {@link compileGlobMatcher} — the caller-supplied scope reaches the
 * same matcher {@link glob} uses, so it cannot backtrack either. Other characters (including
 * `[`, `{`, spaces) use directory-prefix logic so literal VFS path segments are not parsed as
 * glob syntax. Trailing slashes are stripped so `files/` and `files` both scope under `files/...`.
 * Throws {@link GlobPatternError} for a scope outside the safety caps, which both callers catch.
 *
 * Exported so the lazy VFS can resolve exactly the lazy artifacts a scoped grep will consider,
 * keeping "what we materialize" identical to "what grep filters in".
 */
export function pathWithinGrepScope(filePath: string, scope: string): boolean {
  const scopeUsesStarOrQuestionGlob = /[*?]/.test(scope)
  if (scopeUsesStarOrQuestionGlob) {
    return getGlobMatcher(scope)?.matches(filePath) ?? false
  }
  const base = scope.replace(/\/+$/, '')
  if (base === '') {
    return true
  }
  return filePath === base || filePath.startsWith(`${base}/`)
}

/**
 * Regex search over VFS file contents using RE2 syntax — a subset of
 * ECMAScript `RegExp` (see `@/lib/core/security/linear-regex`).
 *
 * A pattern RE2 cannot represent — negative lookaround, backreferences — is
 * matched as a literal instead of on the backtracking engine, as is a pattern
 * that does not compile at all (which previously returned no results). Both
 * cases log a warning: the return shape carries results only, so there is
 * nowhere to tell the caller inline, and a literal fallback can match the
 * pattern's own text when grepping source that contains regexes.
 *
 * `content` and `count` are line-oriented (split on newline, CR stripped per line).
 * `files_with_matches` tests the entire file string once, so multiline patterns can match there
 * but not in line modes.
 */
export function grep(
  files: Map<string, string>,
  pattern: string,
  path?: string,
  opts?: GrepOptions
): GrepMatch[] | string[] | GrepCountEntry[] {
  const maxResults = opts?.maxResults ?? 100
  const outputMode = opts?.outputMode ?? 'content'
  const ignoreCase = opts?.ignoreCase ?? false
  const showLineNumbers = opts?.lineNumbers ?? true
  const contextLines = opts?.context ?? 0

  // Caller-supplied pattern over caller-supplied file content on the shared
  // event loop — matched by RE2 so it cannot backtrack. Syntax RE2 cannot
  // represent degrades to a literal rather than to the backtracking engine.
  let regex: LinearRegex
  if (isPlainText(pattern)) {
    regex = literalRegex(pattern, { ignoreCase })
  } else {
    const linear = compileLinearRegex(pattern, { ignoreCase })
    if (!linear) {
      // The return shape carries results only, so the caller cannot be told
      // inline that its regex was taken literally — log it, since silently
      // returning "no matches" reads as "not in the file".
      logger.warn('Grep pattern is not RE2-representable; matching it literally', { pattern })
    }
    regex = linear ?? literalRegex(pattern, { ignoreCase })
  }

  if (outputMode === 'files_with_matches') {
    const matchingFiles: string[] = []
    for (const [filePath, content] of files) {
      if (path && !pathWithinGrepScope(filePath, path)) continue
      if (regex.test(content)) {
        matchingFiles.push(filePath)
        if (matchingFiles.length >= maxResults) break
      }
    }
    return matchingFiles
  }

  if (outputMode === 'count') {
    const counts: GrepCountEntry[] = []
    for (const [filePath, content] of files) {
      if (path && !pathWithinGrepScope(filePath, path)) continue
      const lines = splitLinesForGrep(content)
      let count = 0
      for (const line of lines) {
        if (regex.test(line)) count++
      }
      if (count > 0) {
        counts.push({ path: filePath, count })
        if (counts.length >= maxResults) break
      }
    }
    return counts
  }

  // Default: 'content' mode
  const matches: GrepMatch[] = []
  for (const [filePath, content] of files) {
    if (path && !pathWithinGrepScope(filePath, path)) continue

    const lines = splitLinesForGrep(content)
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        if (contextLines > 0) {
          const start = Math.max(0, i - contextLines)
          const end = Math.min(lines.length - 1, i + contextLines)
          for (let j = start; j <= end; j++) {
            matches.push({
              path: filePath,
              line: showLineNumbers ? j + 1 : 0,
              content: lines[j],
            })
          }
        } else {
          matches.push({
            path: filePath,
            line: showLineNumbers ? i + 1 : 0,
            content: lines[i],
          })
        }
        if (matches.length >= maxResults) return matches
      }
    }
  }

  return matches
}

/**
 * Glob pattern matching against VFS file paths and virtual directories using `micromatch`'s
 * own compiled pattern under {@link VFS_GLOB_OPTIONS} (path-aware `*` and `?`, `**`, no brace
 * or extglob expansion), executed on RE2 by {@link compileGlobMatcher}. Returns matching file
 * keys and virtual directory prefixes.
 *
 * Throws {@link GlobPatternError} for a pattern outside the safety caps, and returns no
 * matches for one RE2 cannot represent.
 */
export function glob(files: Map<string, string>, pattern: string): string[] {
  const matcher = getGlobMatcher(pattern)
  if (!matcher) return []

  const result = new Set<string>()

  const directories = new Set<string>()
  for (const filePath of files.keys()) {
    if (filePath.endsWith('/.folder')) {
      directories.add(filePath.slice(0, -'/.folder'.length))
      continue
    }
    const parts = filePath.split('/')
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'))
    }
  }

  for (const filePath of files.keys()) {
    if (filePath.endsWith('/.folder')) continue
    if (matcher.matches(filePath)) {
      result.add(filePath)
    }
  }

  for (const dir of directories) {
    if (matcher.matches(dir)) {
      result.add(dir)
    }
  }

  return Array.from(result).sort()
}

/**
 * Read a VFS file's content, optionally with offset and limit.
 * Returns null if the file does not exist.
 */
export function read(
  files: Map<string, string>,
  path: string,
  offset?: number,
  limit?: number
): ReadResult | null {
  let content = files.get(path)

  // Fallback: normalize Unicode and retry for encoding mismatches
  if (content === undefined) {
    const normalized = path.normalize('NFC')
    content = files.get(normalized)
    if (content === undefined) {
      for (const [key, value] of files) {
        if (key.normalize('NFC') === normalized) {
          content = value
          break
        }
      }
    }
  }

  if (content === undefined) return null

  const lines = content.split('\n')
  const totalLines = lines.length

  if (offset !== undefined || limit !== undefined) {
    const rawStart = Number.isFinite(offset) ? (offset as number) : 0
    const start = Math.max(0, Math.min(totalLines, rawStart))
    const rawEnd = limit !== undefined ? start + Math.max(0, limit) : totalLines
    const end = Math.max(start, Math.min(totalLines, rawEnd))
    return {
      content: lines.slice(start, end).join('\n'),
      totalLines,
    }
  }

  return { content, totalLines }
}

/**
 * Find VFS paths similar to a missing path.
 *
 * Handles two cases:
 * 1. Wrong filename: `components/blocks/gmail.json` → `gmail_v2.json`
 *    Matches by filename stem similarity within the same directory.
 * 2. Wrong directory: `workflows/Untitled/state.json` → `Untitled Workflow`
 *    Matches by parent directory name similarity with the same filename.
 */
export function suggestSimilar(files: Map<string, string>, missingPath: string, max = 5): string[] {
  const segments = missingPath.split('/')
  const filename = segments[segments.length - 1].toLowerCase()
  const fileStem = filename.replace(/\.[^.]+$/, '')
  const parentDir = segments.length >= 2 ? segments[segments.length - 2].toLowerCase() : ''
  const topDir = segments.length >= 1 ? `${segments[0]}/` : ''

  const scored: Array<{ path: string; score: number }> = []

  for (const vfsPath of files.keys()) {
    const vfsSegments = vfsPath.split('/')
    const vfsFilename = vfsSegments[vfsSegments.length - 1].toLowerCase()
    const vfsStem = vfsFilename.replace(/\.[^.]+$/, '')
    const vfsParentDir =
      vfsSegments.length >= 2 ? vfsSegments[vfsSegments.length - 2].toLowerCase() : ''
    const sameTopDir = topDir && vfsPath.startsWith(topDir)

    // Same filename, different directory — the directory name is wrong.
    // e.g. workflows/Untitled/state.json vs workflows/Untitled Workflow/state.json
    if (vfsFilename === filename && vfsParentDir !== parentDir && sameTopDir) {
      if (vfsParentDir.includes(parentDir) || parentDir.includes(vfsParentDir)) {
        scored.push({ path: vfsPath, score: 95 })
        continue
      }
    }

    // Same directory, different filename — the filename is wrong.
    const sameDir =
      segments.length === vfsSegments.length &&
      segments.slice(0, -1).join('/') === vfsSegments.slice(0, -1).join('/')

    if (sameDir) {
      if (vfsStem === fileStem) {
        scored.push({ path: vfsPath, score: 100 })
      } else if (vfsStem.includes(fileStem) || fileStem.includes(vfsStem)) {
        scored.push({ path: vfsPath, score: 80 })
      } else if (vfsFilename.includes(fileStem.replace(/[_-]/g, ''))) {
        scored.push({ path: vfsPath, score: 60 })
      }
    } else if (sameTopDir && vfsStem === fileStem) {
      // Same top-level directory and matching stem but different depth/parent
      scored.push({ path: vfsPath, score: 50 })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map((s) => s.path)
}

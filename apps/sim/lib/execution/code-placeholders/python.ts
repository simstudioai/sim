import { sha256Hex } from '@sim/security/hash'
import {
  applySourceEdits,
  CodePlaceholderCompileError,
  CodePlaceholderInvariantError,
  createCodePlaceholderCompilationContext,
  createOffsetRangeLookup,
  occurrencesWithin,
  partitionPoint,
  type SourceEdit,
} from '@/lib/execution/code-placeholders/shared'
import type {
  CodePlaceholderCompilationContext,
  CodePlaceholderOccurrence,
  CompiledCodePlaceholders,
  InternalCompileCodePlaceholdersInput,
} from '@/lib/execution/code-placeholders/types'

interface PythonStringToken {
  start: number
  end: number
  prefix: string
  quoteLength: 1 | 3
  bracketDepth: number
}

interface PythonLexResult {
  strings: PythonStringToken[]
  comments: Array<[number, number]>
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character)
}

/** The token wholly containing `occurrence`, found by bisection over ordered, disjoint tokens. */
function findContainingToken(
  tokens: readonly PythonStringToken[],
  occurrence: CodePlaceholderOccurrence
): PythonStringToken | undefined {
  const token =
    tokens[partitionPoint(tokens, (candidate) => candidate.start <= occurrence.start) - 1]
  return token && occurrence.end <= token.end ? token : undefined
}

function readPythonStringStart(
  code: string,
  index: number
): { prefix: string; quote: string } | null {
  if (isIdentifierCharacter(code[index - 1])) return null
  const match = /^(?:[rRuUbBfF]{0,3})(?:'''|"""|'|")/.exec(code.slice(index))
  if (!match) return null
  const quoteMatch = /('''|"""|'|")$/.exec(match[0])
  if (!quoteMatch) return null
  return { prefix: match[0].slice(0, -quoteMatch[1].length), quote: quoteMatch[1] }
}

function readPythonStringToken(
  code: string,
  index: number,
  bracketDepth: number
): PythonStringToken | null {
  const stringStart = readPythonStringStart(code, index)
  if (!stringStart) return null

  const start = index
  const quoteLength = stringStart.quote.length as 1 | 3
  const formatted = /f/i.test(stringStart.prefix)
  let replacementDepth = 0
  let replacementParentheses = 0
  let replacementBrackets = 0
  let inFormatSpec = false
  let expressionComment = false
  index += stringStart.prefix.length + quoteLength
  while (index < code.length) {
    const character = code[index]
    if (replacementDepth > 0) {
      if (expressionComment) {
        if (character === '\n' || character === '\r') expressionComment = false
        index += 1
        continue
      }
      const nestedString = readPythonStringToken(code, index, replacementDepth)
      if (nestedString) {
        index = nestedString.end
        continue
      }
      if (character === '#' && (!inFormatSpec || replacementDepth > 1)) {
        expressionComment = true
        index += 1
        continue
      }
      if (character === '\\') {
        index += Math.min(2, code.length - index)
        continue
      }
      if (character === '(') replacementParentheses += 1
      else if (character === ')' && replacementParentheses > 0) replacementParentheses -= 1
      else if (character === '[') replacementBrackets += 1
      else if (character === ']' && replacementBrackets > 0) replacementBrackets -= 1
      else if (
        character === ':' &&
        replacementDepth === 1 &&
        replacementParentheses === 0 &&
        replacementBrackets === 0
      ) {
        inFormatSpec = true
      } else if (character === '{') replacementDepth += 1
      else if (character === '}') {
        replacementDepth -= 1
        if (replacementDepth === 0) {
          replacementParentheses = 0
          replacementBrackets = 0
          inFormatSpec = false
        }
      }
      index += 1
      continue
    }
    if (code[index] === '\\') {
      index += Math.min(2, code.length - index)
      continue
    }
    if (code.startsWith(stringStart.quote, index)) {
      index += quoteLength
      break
    }
    if (formatted && character === '{') {
      if (code[index + 1] === '{') index += 2
      else {
        replacementDepth = 1
        replacementParentheses = 0
        replacementBrackets = 0
        inFormatSpec = false
        index += 1
      }
      continue
    }
    if (formatted && character === '}' && code[index + 1] === '}') {
      index += 2
      continue
    }
    if (quoteLength === 1 && character === '\n') break
    index += 1
  }
  return { start, end: index, prefix: stringStart.prefix, quoteLength, bracketDepth }
}

function lexPython(code: string): PythonLexResult {
  const strings: PythonStringToken[] = []
  const comments: Array<[number, number]> = []
  let bracketDepth = 0
  for (let index = 0; index < code.length; ) {
    if (code[index] === '#') {
      const end = code.indexOf('\n', index)
      const commentEnd = end === -1 ? code.length : end
      comments.push([index, commentEnd])
      index = commentEnd
      continue
    }

    const stringToken = readPythonStringToken(code, index, bracketDepth)
    if (!stringToken) {
      if (code[index] === '(' || code[index] === '[' || code[index] === '{') {
        bracketDepth += 1
      } else if (
        (code[index] === ')' || code[index] === ']' || code[index] === '}') &&
        bracketDepth > 0
      ) {
        bracketDepth -= 1
      }
      index += 1
      continue
    }
    strings.push(stringToken)
    index = stringToken.end
  }
  return { strings, comments }
}

function lexNestedFStringStrings(code: string, token: PythonStringToken): PythonStringToken[] {
  if (!/f/i.test(token.prefix)) return []

  const strings: PythonStringToken[] = []
  const contentStart = token.start + token.prefix.length + token.quoteLength
  const contentEnd = token.end - token.quoteLength
  let depth = 0
  let parentheses = 0
  let brackets = 0
  let inFormatSpec = false
  let comment = false
  for (let index = contentStart; index < contentEnd; ) {
    const character = code[index]
    if (comment) {
      if (character === '\n' || character === '\r') comment = false
      index += 1
      continue
    }

    const nestedString =
      depth > 0
        ? readPythonStringToken(code, index, parentheses + brackets + (depth > 0 ? 1 : 0))
        : null
    if (nestedString) {
      strings.push(nestedString)
      index = nestedString.end
      continue
    }
    if (depth > 0 && (!inFormatSpec || depth > 1) && character === '#') {
      comment = true
      index += 1
      continue
    }
    if (depth > 0 && character === '(') parentheses += 1
    else if (depth > 0 && character === ')' && parentheses > 0) parentheses -= 1
    else if (depth > 0 && character === '[') brackets += 1
    else if (depth > 0 && character === ']' && brackets > 0) brackets -= 1
    else if (depth === 1 && parentheses === 0 && brackets === 0 && character === ':') {
      inFormatSpec = true
    } else if (character === '{') {
      if (depth === 0 && code[index + 1] === '{') index += 1
      else depth += 1
    } else if (character === '}') {
      if (depth === 0 && code[index + 1] === '}') index += 1
      else if (depth > 0) {
        depth -= 1
        if (depth === 0) inFormatSpec = false
      }
    }
    index += 1
  }
  return strings
}

function createSentinel(code: string): string {
  const sourceDigest = sha256Hex(code)
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const digest = sha256Hex(`${sourceDigest}\0${attempt}`)
    const sentinel = `__sim_placeholder_${digest}__`
    if (!code.includes(sentinel)) return sentinel
  }
  throw new CodePlaceholderInvariantError('Unable to allocate a collision-free Python marker')
}

/** `comments` are ordered and disjoint; the scan starts at the first that can overlap the gap. */
function pythonTriviaGap(
  code: string,
  start: number,
  end: number,
  comments: ReadonlyArray<[number, number]>,
  firstComment: number
): string {
  let gap = ''
  let cursor = start
  for (let index = firstComment; index < comments.length && comments[index][0] < end; index++) {
    const overlapStart = Math.max(cursor, comments[index][0])
    const overlapEnd = Math.min(end, comments[index][1])
    if (overlapStart >= overlapEnd) continue
    gap += `${code.slice(cursor, overlapStart)}${' '.repeat(overlapEnd - overlapStart)}`
    cursor = overlapEnd
  }
  return gap + code.slice(cursor, end)
}

function groupAdjacentStrings(
  code: string,
  strings: PythonStringToken[],
  comments: ReadonlyArray<[number, number]>
): PythonStringToken[][] {
  const groups: PythonStringToken[][] = []
  let firstComment = 0
  for (const token of strings) {
    const current = groups.at(-1)
    const previous = current?.at(-1)
    let gap = ''
    if (previous) {
      while (firstComment < comments.length && comments[firstComment][1] <= previous.end) {
        firstComment += 1
      }
      gap = pythonTriviaGap(code, previous.end, token.start, comments, firstComment)
    }
    const sameLogicalExpression =
      !/[\r\n]/.test(gap) ||
      (previous !== undefined && previous.bracketDepth > 0 && token.bracketDepth > 0) ||
      /^[ \t]*(?:\\\r?\n[ \t]*)+$/.test(gap)
    if (current && previous && /^\s*(?:\\\r?\n\s*)*$/.test(gap) && sameLogicalExpression) {
      current.push(token)
    } else {
      groups.push([token])
    }
  }
  return groups
}

type FStringPosition =
  | 'literal'
  | 'expression'
  | 'format'
  | 'conversion'
  | 'nested-string'
  | 'comment'
  | 'debug'

interface FStringExpressionState {
  depth: number
  parentheses: number
  brackets: number
}

/**
 * Whether a debug `=` follows `start` before its replacement field closes.
 *
 * `decided` holds answers for later placeholders in the same token. Reaching one of them in
 * exactly the state its own scan started from means the rest of this scan would repeat that
 * one, so its answer is reused: a field holding many placeholders is scanned once, not once each.
 */
function hasFStringDebugMarker(
  code: string,
  token: PythonStringToken,
  start: number,
  initial: FStringExpressionState,
  decided: ReadonlyMap<number, FStringExpressionState & { debug: boolean }>
): boolean {
  const contentEnd = token.end - token.quoteLength
  let { depth, parentheses, brackets } = initial
  let nestedString: { delimiter: string } | null = null
  let comment = false

  for (let index = start; index < contentEnd; index += 1) {
    const character = code[index]
    if (comment) {
      if (character === '\n' || character === '\r') comment = false
      continue
    }
    if (nestedString) {
      if (character === '\\') {
        index += 1
      } else if (code.startsWith(nestedString.delimiter, index)) {
        index += nestedString.delimiter.length - 1
        nestedString = null
      }
      continue
    }
    const stringStart = depth > 0 ? readPythonStringStart(code, index) : null
    if (stringStart) {
      nestedString = { delimiter: stringStart.quote }
      index += stringStart.prefix.length + stringStart.quote.length - 1
      continue
    }
    if (depth > 0 && character === '#') {
      comment = true
      continue
    }
    if (code.startsWith('{{', index)) {
      const later = decided.get(index)
      if (
        later &&
        later.depth === depth &&
        later.parentheses === parentheses &&
        later.brackets === brackets
      ) {
        return later.debug
      }
      const placeholderEnd = code.indexOf('}}', index + 2)
      if (placeholderEnd !== -1) {
        index = placeholderEnd + 1
        continue
      }
    }
    if (character === '(') parentheses += 1
    else if (character === ')' && parentheses > 0) parentheses -= 1
    else if (character === '[') brackets += 1
    else if (character === ']' && brackets > 0) brackets -= 1
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth <= 0) return false
    } else if (
      depth === 1 &&
      parentheses === 0 &&
      brackets === 0 &&
      character === '=' &&
      code[index - 1] !== '=' &&
      code[index - 1] !== '!' &&
      code[index - 1] !== '<' &&
      code[index - 1] !== '>' &&
      code[index - 1] !== ':' &&
      code[index + 1] !== '='
    ) {
      return true
    }
  }
  return false
}

/**
 * Classifies every placeholder offset (ascending) inside one string token in a single pass.
 * Re-scanning the token from its start for each placeholder is quadratic in user code.
 */
function getFStringPositions(
  code: string,
  token: PythonStringToken,
  offsets: readonly number[]
): FStringPosition[] {
  if (!/f/i.test(token.prefix)) return offsets.map(() => 'literal')
  const quoteLength = token.quoteLength
  const contentStart = token.start + token.prefix.length + quoteLength
  const contentEnd = token.end - quoteLength
  let depth = 0
  let parentheses = 0
  let brackets = 0
  let inFormatSpec = false
  let inConversion = false
  let nestedString: { delimiter: string } | null = null
  let comment = false
  const positions: FStringPosition[] = []
  const expressionStates = new Map<number, FStringExpressionState>()
  const recordPositionsThrough = (index: number) => {
    while (positions.length < offsets.length && offsets[positions.length] <= index) {
      if (comment) positions.push('comment')
      else if (nestedString) positions.push('nested-string')
      else if (depth === 0) positions.push('literal')
      else if (inFormatSpec && depth === 1) positions.push('format')
      else if (inConversion) positions.push('conversion')
      else {
        expressionStates.set(positions.length, { depth, parentheses, brackets })
        positions.push('expression')
      }
    }
  }
  for (let index = contentStart; index < contentEnd; index += 1) {
    recordPositionsThrough(index)
    if (positions.length === offsets.length) break
    const character = code[index]
    if (comment) {
      if (character === '\n' || character === '\r') comment = false
      continue
    }
    if (nestedString) {
      if (character === '\\') {
        index += 1
      } else if (code.startsWith(nestedString.delimiter, index)) {
        index += nestedString.delimiter.length - 1
        nestedString = null
      }
      continue
    }
    const stringStart = depth > 0 ? readPythonStringStart(code, index) : null
    if (stringStart) {
      nestedString = { delimiter: stringStart.quote }
      index += stringStart.prefix.length + stringStart.quote.length - 1
      continue
    }
    if (depth > 0 && !inFormatSpec && character === '#') {
      comment = true
      continue
    }
    if (depth > 0 && character === '(') {
      parentheses += 1
      continue
    }
    if (depth > 0 && character === ')' && parentheses > 0) {
      parentheses -= 1
      continue
    }
    if (depth > 0 && character === '[') {
      brackets += 1
      continue
    }
    if (depth > 0 && character === ']' && brackets > 0) {
      brackets -= 1
      continue
    }
    if (
      depth === 1 &&
      parentheses === 0 &&
      brackets === 0 &&
      character === '!' &&
      code[index + 1] !== '='
    ) {
      inConversion = true
      continue
    }
    if (depth === 1 && parentheses === 0 && brackets === 0 && character === ':') {
      inFormatSpec = true
      inConversion = false
      continue
    }
    if (character === '{') {
      if (depth === 0 && code[index + 1] === '{') {
        index += 1
      } else {
        depth += 1
      }
    } else if (character === '}') {
      if (depth === 0 && code[index + 1] === '}') index += 1
      else if (depth > 0) {
        depth -= 1
        if (depth === 0) {
          parentheses = 0
          brackets = 0
          inFormatSpec = false
          inConversion = false
        }
      }
    }
  }
  recordPositionsThrough(Number.POSITIVE_INFINITY)

  const decided = new Map<number, FStringExpressionState & { debug: boolean }>()
  for (const [position, state] of [...expressionStates].reverse()) {
    const debug = hasFStringDebugMarker(code, token, offsets[position], state, decided)
    if (debug) positions[position] = 'debug'
    decided.set(offsets[position], { ...state, debug })
  }
  return positions
}

function buildSimultaneousInterpolation(
  expression: string,
  sentinel: string | undefined,
  accessors: string[],
  bytes: boolean
): string {
  if (!sentinel || accessors.length === 0) return expression

  const parts = '__sim_parts'
  const sentinelLiteral = bytes ? `b${JSON.stringify(sentinel)}` : JSON.stringify(sentinel)
  const values: string[] = [`${parts}[0]`]
  for (const [index, accessor] of accessors.entries()) {
    values.push(bytes ? `${accessor}.encode("utf-8")` : accessor, `${parts}[${index + 1}]`)
  }
  const empty = bytes ? 'b""' : '""'
  const expectedParts = accessors.length + 1
  return `(lambda ${parts}: ${empty}.join([${values.join(', ')}]) if ${parts}.__len__() == ${expectedParts} else {}["Sim placeholder interpolation mismatch"])((${expression}).split(${sentinelLiteral}))`
}

function pythonRuntimeValue(bindingName: string): string {
  return `(${bindingName} if True else None)`
}

type PythonBarePlaceholderPosition = 'value' | 'attribute' | 'unsupported-name'

const ASSIGNMENT_OPERATOR = /^(?:=(?!=)|:=|\+=|-=|\*=|\/=|\/\/=|%=|@=|&=|\|=|\^=|>>=|<<=|\*\*=)/
const NAME_POSITION_KEYWORDS = [
  'def',
  'class',
  'import',
  'from',
  'as',
  'global',
  'nonlocal',
  'del',
  'for',
  'lambda',
] as const

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character)
}

interface PythonKeywordHead {
  start: number
  /** End of the whitespace run that follows the keyword. */
  whitespaceEnd: number
  /** First carriage return at or after `whitespaceEnd`, or `Infinity`. */
  carriageReturnAfter: number
}

interface PythonSourceIndex {
  newlines: number[]
  carriageReturns: number[]
  openParens: number[]
  closeParens: number[]
  commas: number[]
  equals: number[]
  colons: number[]
  /** `(` offsets that close a `def name(` head. */
  defParens: number[]
  forHeads: PythonKeywordHead[]
  delHeads: PythonKeywordHead[]
  /** `in` tokens with whitespace on both sides. */
  inTokens: number[]
  /** `lambda` and `if` offsets not adjoining an identifier character. */
  lambdas: number[]
  ifs: number[]
}

function firstAtOrAfter(offsets: readonly number[], offset: number): number {
  return partitionPoint(offsets, (candidate) => candidate < offset)
}

function hasOffsetIn(offsets: readonly number[], start: number, end: number): boolean {
  const index = firstAtOrAfter(offsets, start)
  return index < offsets.length && offsets[index] < end
}

/** The last offset in `[start, end)`, or `start - 1` when there is none. */
function lastOffsetIn(offsets: readonly number[], start: number, end: number): number {
  const offset = offsets[firstAtOrAfter(offsets, end) - 1]
  return offset !== undefined && offset >= start ? offset : start - 1
}

function nextOffset(offsets: readonly number[], offset: number, fallback: number): number {
  return offsets[firstAtOrAfter(offsets, offset)] ?? fallback
}

function lineStartOf(newlines: readonly number[], offset: number): number {
  return lastOffsetIn(newlines, 0, offset) + 1
}

function standaloneKeywordOffsets(code: string, keyword: string): number[] {
  const offsets: number[] = []
  for (let index = code.indexOf(keyword); index !== -1; index = code.indexOf(keyword, index + 1)) {
    if (
      !isIdentifierCharacter(code[index - 1]) &&
      !isIdentifierCharacter(code[index + keyword.length])
    ) {
      offsets.push(index)
    }
  }
  return offsets
}

function keywordHeads(
  code: string,
  keyword: string,
  carriageReturns: number[]
): PythonKeywordHead[] {
  const heads: PythonKeywordHead[] = []
  for (let index = code.indexOf(keyword); index !== -1; index = code.indexOf(keyword, index + 1)) {
    if (index > 0 && !isWhitespace(code[index - 1])) continue
    let whitespaceEnd = index + keyword.length
    if (!isWhitespace(code[whitespaceEnd])) continue
    while (isWhitespace(code[whitespaceEnd])) whitespaceEnd += 1
    heads.push({
      start: index,
      whitespaceEnd,
      carriageReturnAfter: nextOffset(carriageReturns, whitespaceEnd, Number.POSITIVE_INFINITY),
    })
  }
  return heads
}

/** Whether the `(` at `paren` closes `def name(`, scanning back no further than `lineStart`. */
function closesDefHead(code: string, paren: number, lineStart: number): boolean {
  let index = paren - 1
  while (index >= lineStart && isWhitespace(code[index])) index -= 1
  const identifierEnd = index + 1
  while (index >= lineStart && isIdentifierCharacter(code[index])) index -= 1
  const identifierStart = index + 1
  if (identifierStart === identifierEnd || !/[A-Za-z_]/.test(code[identifierStart])) return false
  if (index < lineStart || !isWhitespace(code[index])) return false
  while (index >= lineStart && isWhitespace(code[index])) index -= 1
  const defStart = index - 2
  if (defStart < lineStart || !code.startsWith('def', defStart)) return false
  return defStart === lineStart || isWhitespace(code[defStart - 1])
}

function indexPythonSource(code: string): PythonSourceIndex {
  const newlines: number[] = []
  const carriageReturns: number[] = []
  const openParens: number[] = []
  const closeParens: number[] = []
  const commas: number[] = []
  const equals: number[] = []
  const colons: number[] = []
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index]
    if (character === '\n') newlines.push(index)
    else if (character === '\r') carriageReturns.push(index)
    else if (character === '(') openParens.push(index)
    else if (character === ')') closeParens.push(index)
    else if (character === ',') commas.push(index)
    else if (character === '=') equals.push(index)
    else if (character === ':') colons.push(index)
  }
  return {
    newlines,
    carriageReturns,
    openParens,
    closeParens,
    commas,
    equals,
    colons,
    defParens: openParens.filter((paren) =>
      closesDefHead(code, paren, lineStartOf(newlines, paren))
    ),
    forHeads: keywordHeads(code, 'for', carriageReturns),
    delHeads: keywordHeads(code, 'del', carriageReturns),
    inTokens: standaloneKeywordOffsets(code, 'in').filter(
      (offset) => isWhitespace(code[offset - 1]) && isWhitespace(code[offset + 2])
    ),
    lambdas: standaloneKeywordOffsets(code, 'lambda'),
    ifs: standaloneKeywordOffsets(code, 'if'),
  }
}

/**
 * The first head starting at or after `lineStart` whose text up to `end` has no carriage
 * return past its whitespace. Heads are disjoint, so `carriageReturnAfter` only grows along
 * the list and the qualifying heads form a suffix.
 */
function firstHeadClearOfCarriageReturn(
  heads: readonly PythonKeywordHead[],
  lineStart: number,
  end: number
): PythonKeywordHead | undefined {
  return heads[
    Math.max(
      partitionPoint(heads, (head) => head.start < lineStart),
      partitionPoint(heads, (head) => head.carriageReturnAfter < end)
    )
  ]
}

/**
 * Classifies a bare placeholder by the Python construct around it on its line, answering each
 * rule from one sorted offset index of the file instead of a regex over the line prefix.
 * `isIgnored` must be a pure membership test over the whole file: keyword lookbacks memoize
 * their walk per predicate and may probe offsets on earlier lines.
 */
function createPythonBarePlaceholderClassifier(code: string) {
  let sourceIndex: PythonSourceIndex | undefined
  const caseClauses = new Map<
    number,
    { keywordStart: number; prefixStart: number; carriageReturnAfter: number } | null
  >()
  const keywordMemos = new WeakMap<
    (offset: number) => boolean,
    { lambda: Map<number, number>; if: Map<number, number> }
  >()

  /** The last keyword offset at or before `maxStart` that `isIgnored` does not exclude, or -1. */
  const lastUnignored = (
    offsets: readonly number[],
    memo: Map<number, number>,
    isIgnored: (offset: number) => boolean,
    maxStart: number
  ): number => {
    const visited: number[] = []
    let found = -1
    for (
      let index = partitionPoint(offsets, (offset) => offset <= maxStart) - 1;
      index >= 0;
      index -= 1
    ) {
      const known = memo.get(index)
      if (known !== undefined) {
        found = known
        break
      }
      visited.push(index)
      if (!isIgnored(offsets[index])) {
        found = index
        break
      }
    }
    for (const index of visited) memo.set(index, found)
    return found < 0 ? -1 : offsets[found]
  }

  const caseClauseAt = (source: PythonSourceIndex, lineStart: number) => {
    let clause = caseClauses.get(lineStart)
    if (clause === undefined) {
      let keywordStart = lineStart
      while (isWhitespace(code[keywordStart])) keywordStart += 1
      clause = null
      if (code.startsWith('case', keywordStart) && isWhitespace(code[keywordStart + 4])) {
        let prefixStart = keywordStart + 4
        while (isWhitespace(code[prefixStart])) prefixStart += 1
        clause = {
          keywordStart,
          prefixStart,
          carriageReturnAfter: nextOffset(
            source.carriageReturns,
            prefixStart,
            Number.POSITIVE_INFINITY
          ),
        }
      }
      caseClauses.set(lineStart, clause)
    }
    return clause
  }

  return (
    occurrence: CodePlaceholderOccurrence,
    isIgnored: (offset: number) => boolean
  ): PythonBarePlaceholderPosition => {
    const { start, end } = occurrence
    const immediatelyPrevious = code[start - 1]
    const immediatelyNext = code[end]
    let previousIndex = start - 1
    while (previousIndex >= 0 && /[ \t\f]/.test(code[previousIndex])) previousIndex -= 1
    const attribute = code[previousIndex] === '.'
    if (isIdentifierCharacter(immediatelyPrevious) || isIdentifierCharacter(immediatelyNext)) {
      return 'unsupported-name'
    }

    const source = (sourceIndex ??= indexPythonSource(code))
    let memo = keywordMemos.get(isIgnored)
    if (!memo) {
      memo = { lambda: new Map(), if: new Map() }
      keywordMemos.set(isIgnored, memo)
    }
    const lineStart = lineStartOf(source.newlines, start)
    const lineEnd = nextOffset(source.newlines, end, code.length)

    let trailingWhitespace = start
    while (trailingWhitespace > lineStart && isWhitespace(code[trailingWhitespace - 1])) {
      trailingWhitespace -= 1
    }
    const endsWithKeyword = (keyword: string) => {
      const keywordStart = trailingWhitespace - keyword.length
      return (
        keywordStart >= lineStart &&
        code.startsWith(keyword, keywordStart) &&
        (keywordStart === lineStart || isWhitespace(code[keywordStart - 1]))
      )
    }

    const defParen = lastOffsetIn(source.defParens, lineStart, start)
    const parameterStart =
      Math.max(
        lastOffsetIn(source.openParens, lineStart, start),
        lastOffsetIn(source.commas, lineStart, start)
      ) + 1
    const inFunctionParameterName =
      defParen >= lineStart &&
      !hasOffsetIn(source.closeParens, defParen + 1, start) &&
      !hasOffsetIn(source.equals, parameterStart, start) &&
      !hasOffsetIn(source.colons, parameterStart, start)

    const lambdaStart = lastUnignored(
      source.lambdas,
      memo.lambda,
      isIgnored,
      start - 'lambda'.length
    )
    const inLambdaParameterName =
      lambdaStart >= lineStart &&
      !hasOffsetIn(source.colons, lambdaStart, start) &&
      !hasOffsetIn(
        source.equals,
        Math.max(lambdaStart + 'lambda'.length, lastOffsetIn(source.commas, lineStart, start) + 1),
        start
      )

    const forHead = firstHeadClearOfCarriageReturn(source.forHeads, lineStart, start)
    const inForTarget =
      forHead !== undefined &&
      forHead.start <= start - 4 &&
      !hasOffsetIn(source.inTokens, forHead.whitespaceEnd, start - 2)

    let assignmentStart = end
    while (assignmentStart < lineEnd && isWhitespace(code[assignmentStart])) assignmentStart += 1
    const followedByAssignment = ASSIGNMENT_OPERATOR.test(
      code.slice(assignmentStart, Math.min(lineEnd, assignmentStart + 3))
    )

    const caseClause = caseClauseAt(source, lineStart)
    const inCaseClause =
      caseClause !== null &&
      caseClause.keywordStart + 4 < start &&
      caseClause.carriageReturnAfter >= start
    const inCasePattern =
      inCaseClause &&
      !ASSIGNMENT_OPERATOR.test(
        code.slice(caseClause.prefixStart, Math.min(start, caseClause.prefixStart + 3))
      ) &&
      lastUnignored(source.ifs, memo.if, isIgnored, start - 'if'.length) < caseClause.prefixStart &&
      hasOffsetIn(source.colons, end, lineEnd)

    const deletesAttribute = () => {
      const dot = trailingWhitespace - 1
      if (dot < lineStart || code[dot] !== '.') return false
      const delHead = firstHeadClearOfCarriageReturn(source.delHeads, lineStart, dot)
      return delHead !== undefined && delHead.start <= dot - 4
    }

    if (
      NAME_POSITION_KEYWORDS.some(endsWithKeyword) ||
      inFunctionParameterName ||
      inLambdaParameterName ||
      inForTarget ||
      inCasePattern ||
      followedByAssignment ||
      (attribute && deletesAttribute())
    ) {
      return 'unsupported-name'
    }
    if (attribute) return 'attribute'
    return 'value'
  }
}

/**
 * Matches the two ways Python code reaches the runtime environment by a literal name:
 * `environmentVariables['NAME']` and `environmentVariables.get('NAME')`. Attribute access is
 * absent because the binding is a plain dict, where `environmentVariables.NAME` raises.
 */
const PYTHON_DIRECT_ENVIRONMENT_READ =
  /environmentVariables\s*(?:\[\s*(['"])([A-Za-z0-9_]+)\1\s*\]|\.\s*get\s*\(\s*(['"])([A-Za-z0-9_]+)\3)/g

/**
 * Reports environment reads that bypass `{{NAME}}`, skipping any match that the lexer places
 * inside a string or comment — the same authority the placeholder rewriter uses to decide
 * what is real code.
 *
 * `lex` is a thunk, not a result: code with no placeholders returned without lexing at all
 * before this existed, and the overwhelmingly common case is code that never mentions
 * `environmentVariables`. Scanning for that with a regex first keeps the lexer off the path
 * entirely unless there is something to classify.
 */
function recordPythonDirectEnvironmentReads(
  code: string,
  lex: () => PythonLexResult,
  context: CodePlaceholderCompilationContext
): void {
  const matches: RegExpExecArray[] = []
  PYTHON_DIRECT_ENVIRONMENT_READ.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PYTHON_DIRECT_ENVIRONMENT_READ.exec(code)) !== null) {
    if (isIdentifierCharacter(code[match.index - 1])) continue
    if (!context.tracksDirectEnvironmentRead(match[2] ?? match[4] ?? '')) continue
    matches.push(match)
  }
  if (matches.length === 0) return

  const lexed = lex()
  const isIgnored = createOffsetRangeLookup([
    ...lexed.comments,
    ...lexed.strings.map((token): [number, number] => [token.start, token.end]),
  ])

  /**
   * A write or `del` target is reported like any other access, deliberately.
   *
   * `resolvedSecretNames` feeds an exact-value matcher over the output. Naming a secret the
   * code never read costs nothing there — the matcher scans for a value that does not appear
   * — while failing to name one that was read leaves it unmasked. Telling the two apart in
   * Python means textual heuristics, and every one of them has so far leaked in the second,
   * dangerous direction: a nested read inside a `del`, a parenthesized target. So this stops
   * trying, and errs toward reporting.
   *
   * JavaScript keeps its own write/delete exclusion because a real AST answers the question
   * per node, with no text to misread.
   */
  for (const candidate of matches) {
    if (isIgnored(candidate.index)) continue
    /**
     * `other.environmentVariables['K']` reads a different object that merely shares the name,
     * so it is not the mounted binding at all. This is the receiver check the JavaScript side
     * gets from the AST, and unlike a scope or rebinding rule it cannot suppress a genuine
     * read: it only rejects an access whose receiver is demonstrably something else.
     *
     * Whitespace and line continuations are skipped, so a `.` left on a previous line inside
     * parentheses reads the same as one written adjacently — but the dot counts as a
     * qualifier only when it is code. A comment or string on the previous line can end in a
     * period (`# Load the value.`), and discarding on that would drop a genuine read, so the
     * landing position is checked against the same lexer ranges that filter the candidates.
     * This is why the receiver check runs after lexing rather than in the collection loop.
     */
    let previous = candidate.index - 1
    while (previous >= 0 && /[\s\\]/.test(code[previous])) previous -= 1
    if (code[previous] === '.' && !isIgnored(previous)) continue
    const name = candidate[2] ?? candidate[4]
    if (name) context.recordDirectEnvironmentRead(name, candidate.index)
  }
}

export async function compilePythonPlaceholders(
  input: InternalCompileCodePlaceholdersInput
): Promise<CompiledCodePlaceholders> {
  const context = createCodePlaceholderCompilationContext(input, { identifierSuffix: '__' })
  if (context.occurrences.length === 0) {
    recordPythonDirectEnvironmentReads(input.code, () => lexPython(input.code), context)
    return context.finish(input.code)
  }

  const lexed = lexPython(input.code)
  const classifyBarePlaceholder = createPythonBarePlaceholderClassifier(input.code)
  recordPythonDirectEnvironmentReads(input.code, () => lexed, context)
  const edits: SourceEdit[] = []
  const consumed = new Set<CodePlaceholderOccurrence>()
  let compilationSentinel: string | undefined
  const getSentinel = (): string => {
    if (!compilationSentinel) {
      compilationSentinel = createSentinel(input.code)
      context.registerInternalIdentifier(compilationSentinel)
    }
    return compilationSentinel
  }

  for (const group of groupAdjacentStrings(input.code, lexed.strings, lexed.comments)) {
    const start = group[0].start
    const end = group.at(-1)?.end ?? start
    const items = occurrencesWithin(context.occurrences, start, end)
    if (items.length === 0) continue

    let groupSource = input.code.slice(start, end)
    const replacements: string[] = []
    let groupSentinel: string | undefined
    const sourceEdits: SourceEdit[] = []
    const nestedStringGroups = groupAdjacentStrings(
      input.code,
      group.flatMap((token) => lexNestedFStringStrings(input.code, token)),
      []
    )
    const nestedTokens = nestedStringGroups.flat()
    const nestedGroupByToken = new Map(
      nestedStringGroups.flatMap((nestedGroup) =>
        nestedGroup.map((nestedToken) => [nestedToken, nestedGroup] as const)
      )
    )
    const isInNestedString = createOffsetRangeLookup(
      nestedTokens.map(({ start: nestedStart, end: nestedEnd }) => [nestedStart, nestedEnd])
    )
    const classifyOccurrences = (tokens: readonly PythonStringToken[]) => {
      const positions = new Map<CodePlaceholderOccurrence, FStringPosition>()
      for (const token of tokens) {
        const tokenItems = occurrencesWithin(items, token.start, token.end)
        const tokenPositions = getFStringPositions(
          input.code,
          token,
          tokenItems.map((occurrence) => occurrence.start)
        )
        tokenItems.forEach((occurrence, index) => positions.set(occurrence, tokenPositions[index]))
      }
      return positions
    }
    const fStringPositions = classifyOccurrences(group)
    const nestedFStringPositions = classifyOccurrences(nestedTokens)
    const nestedReplacements = new Map<
      PythonStringToken[],
      Array<{ occurrence: CodePlaceholderOccurrence; accessor: string }>
    >()
    for (const occurrence of items) {
      const fStringPosition = fStringPositions.get(occurrence)
      if (!fStringPosition || fStringPosition === 'comment') continue
      if (!context.hasValue(occurrence.name)) continue
      if (fStringPosition === 'nested-string') {
        const nestedToken = findContainingToken(nestedTokens, occurrence)
        const nestedGroup = nestedToken && nestedGroupByToken.get(nestedToken)
        if (nestedGroup && nestedFStringPositions.get(occurrence) === 'literal') {
          const resolved = context.resolve(occurrence)
          if (!resolved) continue
          const pending = nestedReplacements.get(nestedGroup) ?? []
          pending.push({
            occurrence,
            accessor: pythonRuntimeValue(resolved.bindingName),
          })
          nestedReplacements.set(nestedGroup, pending)
          continue
        }
      }
      if (
        fStringPosition === 'conversion' ||
        fStringPosition === 'nested-string' ||
        fStringPosition === 'debug'
      ) {
        if (input.analysisOnly) {
          context.resolveValue(occurrence)
          consumed.add(occurrence)
          continue
        }
        throw new CodePlaceholderCompileError(
          `Variable placeholder "${occurrence.name}" is not supported in this f-string syntax position`,
          input.code,
          occurrence.start
        )
      }
      const resolved = context.resolve(occurrence)
      if (!resolved) continue
      const accessor = pythonRuntimeValue(resolved.bindingName)
      if (fStringPosition === 'expression' || fStringPosition === 'format') {
        if (
          fStringPosition === 'expression' &&
          classifyBarePlaceholder(occurrence, isInNestedString) === 'unsupported-name'
        ) {
          if (input.analysisOnly) {
            context.resolveValue(occurrence)
            consumed.add(occurrence)
            continue
          }
          throw new CodePlaceholderCompileError(
            `Variable placeholder "${occurrence.name}" is not supported in a Python name or assignment position`,
            input.code,
            occurrence.start
          )
        }
        sourceEdits.push({
          start: occurrence.start - start,
          end: occurrence.end - start,
          text: fStringPosition === 'format' ? `{${accessor}}` : accessor,
        })
      } else {
        if (!groupSentinel) {
          groupSentinel = getSentinel()
        }
        sourceEdits.push({
          start: occurrence.start - start,
          end: occurrence.end - start,
          text: groupSentinel,
        })
        replacements.push(accessor)
      }
      consumed.add(occurrence)
    }
    for (const [nestedGroup, pending] of nestedReplacements) {
      const nestedStart = nestedGroup[0].start
      const nestedEnd = nestedGroup.at(-1)?.end ?? nestedStart
      const nestedEdits: SourceEdit[] = []
      const interpolationAccessors: string[] = []
      const nestedSentinel = getSentinel()
      for (const { occurrence, accessor } of pending) {
        nestedEdits.push({
          start: occurrence.start - nestedStart,
          end: occurrence.end - nestedStart,
          text: nestedSentinel,
        })
        interpolationAccessors.push(accessor)
        consumed.add(occurrence)
      }
      const nestedSource = applySourceEdits(input.code.slice(nestedStart, nestedEnd), nestedEdits)
      sourceEdits.push({
        start: nestedStart - start,
        end: nestedEnd - start,
        text: buildSimultaneousInterpolation(
          nestedSource,
          nestedSentinel,
          interpolationAccessors,
          nestedGroup.every((nestedToken) => /b/i.test(nestedToken.prefix))
        ),
      })
    }
    if (sourceEdits.length === 0) continue
    groupSource = applySourceEdits(groupSource, sourceEdits)
    const bytes = group.every((token) => /b/i.test(token.prefix))
    edits.push({
      start,
      end,
      text: buildSimultaneousInterpolation(groupSource, groupSentinel, replacements, bytes),
    })
  }

  const isInComment = createOffsetRangeLookup(lexed.comments)
  const isInStringOrComment = createOffsetRangeLookup([
    ...lexed.strings.map(({ start, end }) => [start, end] as [number, number]),
    ...lexed.comments,
  ])
  for (const occurrence of context.occurrences) {
    if (consumed.has(occurrence) || isInComment(occurrence.start)) continue
    if (findContainingToken(lexed.strings, occurrence)) continue
    if (!context.hasValue(occurrence.name)) continue
    const position = classifyBarePlaceholder(occurrence, isInStringOrComment)
    if (position === 'unsupported-name') {
      if (input.analysisOnly) {
        context.resolveValue(occurrence)
        consumed.add(occurrence)
        continue
      }
      throw new CodePlaceholderCompileError(
        `Variable placeholder "${occurrence.name}" is not supported in a Python name or assignment position`,
        input.code,
        occurrence.start
      )
    }
    const resolved = context.resolve(occurrence)
    if (!resolved) continue
    edits.push({
      start: occurrence.start,
      end: occurrence.end,
      text:
        position === 'attribute'
          ? `__getattribute__(${pythonRuntimeValue(resolved.bindingName)})`
          : pythonRuntimeValue(resolved.bindingName),
    })
    consumed.add(occurrence)
  }

  return context.finish(applySourceEdits(input.code, edits))
}

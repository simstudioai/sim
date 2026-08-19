import { sha256Hex } from '@sim/security/hash'
import {
  applySourceEdits,
  CodePlaceholderCompileError,
  createCodePlaceholderCompilationContext,
  isOffsetInRanges,
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

function findLastPythonKeyword(
  value: string,
  keyword: string,
  isIgnored: (index: number) => boolean = () => false
): number {
  let index = value.lastIndexOf(keyword)
  while (index >= 0) {
    const before = value[index - 1]
    const after = value[index + keyword.length]
    if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after) && !isIgnored(index)) {
      return index
    }
    index = value.lastIndexOf(keyword, index - 1)
  }
  return -1
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
  throw new CodePlaceholderCompileError('Unable to allocate a collision-free Python marker')
}

function pythonTriviaGap(
  code: string,
  start: number,
  end: number,
  comments: ReadonlyArray<[number, number]>
): string {
  let gap = code.slice(start, end)
  for (const [commentStart, commentEnd] of comments) {
    const overlapStart = Math.max(start, commentStart)
    const overlapEnd = Math.min(end, commentEnd)
    if (overlapStart >= overlapEnd) continue
    const relativeStart = overlapStart - start
    const relativeEnd = overlapEnd - start
    gap = `${gap.slice(0, relativeStart)}${' '.repeat(relativeEnd - relativeStart)}${gap.slice(relativeEnd)}`
  }
  return gap
}

function groupAdjacentStrings(
  code: string,
  strings: PythonStringToken[],
  comments: ReadonlyArray<[number, number]>
): PythonStringToken[][] {
  const groups: PythonStringToken[][] = []
  for (const token of strings) {
    const current = groups.at(-1)
    const previous = current?.at(-1)
    const gap = previous ? pythonTriviaGap(code, previous.end, token.start, comments) : ''
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

function hasFStringDebugMarker(
  code: string,
  token: PythonStringToken,
  start: number,
  initialDepth: number,
  initialParentheses: number,
  initialBrackets: number
): boolean {
  const contentEnd = token.end - token.quoteLength
  let depth = initialDepth
  let parentheses = initialParentheses
  let brackets = initialBrackets
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

function getFStringPosition(
  code: string,
  token: PythonStringToken,
  absoluteOffset: number
): FStringPosition {
  if (!/f/i.test(token.prefix)) return 'literal'
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
  for (let index = contentStart; index < contentEnd && index < absoluteOffset; index += 1) {
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
  if (comment) return 'comment'
  if (nestedString) return 'nested-string'
  if (depth === 0) return 'literal'
  if (inFormatSpec && depth === 1) return 'format'
  if (inConversion) return 'conversion'
  if (hasFStringDebugMarker(code, token, absoluteOffset, depth, parentheses, brackets)) {
    return 'debug'
  }
  return 'expression'
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

function classifyPythonBarePlaceholder(
  code: string,
  occurrence: CodePlaceholderOccurrence,
  ignoredRanges: ReadonlyArray<[number, number]> = []
): PythonBarePlaceholderPosition {
  const immediatelyPrevious = code[occurrence.start - 1]
  const immediatelyNext = code[occurrence.end]
  let previousIndex = occurrence.start - 1
  while (previousIndex >= 0 && /[ \t\f]/.test(code[previousIndex])) previousIndex -= 1
  const previous = code[previousIndex]
  const attribute = previous === '.'
  if (isIdentifierCharacter(immediatelyPrevious) || isIdentifierCharacter(immediatelyNext)) {
    return 'unsupported-name'
  }

  const lineStart = code.lastIndexOf('\n', occurrence.start - 1) + 1
  const nextNewline = code.indexOf('\n', occurrence.end)
  const lineEnd = nextNewline === -1 ? code.length : nextNewline
  const before = code.slice(lineStart, occurrence.start)
  const after = code.slice(occurrence.end, lineEnd)
  const isIgnoredBeforeOffset = (offset: number): boolean =>
    isOffsetInRanges(lineStart + offset, ignoredRanges)
  const parameterSegment = before.slice(
    Math.max(before.lastIndexOf('('), before.lastIndexOf(',')) + 1
  )
  const inFunctionParameterName =
    /(?:^|\s)(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*$/.test(before) &&
    !/[=:]/.test(parameterSegment)
  const lambdaStart = findLastPythonKeyword(before, 'lambda', isIgnoredBeforeOffset)
  const inLambdaParameterName =
    lambdaStart >= 0 &&
    before.indexOf(':', lambdaStart) === -1 &&
    !before
      .slice(Math.max(lambdaStart + 'lambda'.length, before.lastIndexOf(',') + 1))
      .includes('=')
  const forMatch = /(?:^|\s)(?:async\s+)?for\s+([^\r\n]*)$/.exec(before)
  const inForTarget = forMatch !== null && !/(?:^|\s)in\s/.test(forMatch[1])
  const followedByAssignment =
    /^\s*(?:=(?!=)|:=|\+=|-=|\*=|\/=|\/\/=|%=|@=|&=|\|=|\^=|>>=|<<=|\*\*=)/.test(after)
  const caseClause = /^\s*case\s+([^\r\n]*)$/.exec(before)
  const casePrefix = caseClause?.[1] ?? ''
  const caseStartsWithAssignment =
    /^(?:=(?!=)|:=|\+=|-=|\*=|\/=|\/\/=|%=|@=|&=|\|=|\^=|>>=|<<=|\*\*=)/.test(casePrefix)
  const casePrefixOffset = before.length - casePrefix.length
  const inCasePattern =
    caseClause !== null &&
    !caseStartsWithAssignment &&
    findLastPythonKeyword(casePrefix, 'if', (offset) =>
      isIgnoredBeforeOffset(casePrefixOffset + offset)
    ) === -1 &&
    after.includes(':')
  if (
    /(?:^|\s)(?:async\s+)?(?:def|class|import|from|as|global|nonlocal|del)\s*$/.test(before) ||
    /(?:^|\s)(?:async\s+)?for\s*$/.test(before) ||
    /(?:^|\s)(?:as|lambda)\s*$/.test(before) ||
    inFunctionParameterName ||
    inLambdaParameterName ||
    inForTarget ||
    inCasePattern ||
    followedByAssignment ||
    (attribute && /(?:^|\s)del\s+[^\r\n]*\.\s*$/.test(before))
  ) {
    return 'unsupported-name'
  }
  if (attribute) return 'attribute'
  return 'value'
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
  const ignoredRanges: Array<[number, number]> = [
    ...lexed.comments,
    ...lexed.strings.map((token): [number, number] => [token.start, token.end]),
  ]

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
    if (isOffsetInRanges(candidate.index, ignoredRanges)) continue
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
    if (code[previous] === '.' && !isOffsetInRanges(previous, ignoredRanges)) continue
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
    const items = context.occurrences.filter(
      (occurrence) => occurrence.start >= start && occurrence.end <= end
    )
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
    const nestedReplacements = new Map<
      PythonStringToken[],
      Array<{ occurrence: CodePlaceholderOccurrence; accessor: string }>
    >()
    for (const occurrence of items) {
      const token = group.find(
        (candidate) => occurrence.start >= candidate.start && occurrence.end <= candidate.end
      )
      if (!token) continue
      const fStringPosition = getFStringPosition(input.code, token, occurrence.start)
      if (fStringPosition === 'comment') continue
      if (!context.hasValue(occurrence.name)) continue
      if (fStringPosition === 'nested-string') {
        const nestedGroup = nestedStringGroups.find((candidate) =>
          candidate.some(
            (nestedToken) =>
              occurrence.start >= nestedToken.start && occurrence.end <= nestedToken.end
          )
        )
        const nestedToken = nestedGroup?.find(
          (candidate) => occurrence.start >= candidate.start && occurrence.end <= candidate.end
        )
        if (
          nestedGroup &&
          nestedToken &&
          getFStringPosition(input.code, nestedToken, occurrence.start) === 'literal'
        ) {
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
          classifyPythonBarePlaceholder(
            input.code,
            occurrence,
            nestedStringGroups
              .flat()
              .map(
                ({ start: nestedStart, end: nestedEnd }) =>
                  [nestedStart, nestedEnd] as [number, number]
              )
          ) === 'unsupported-name'
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

  for (const occurrence of context.occurrences) {
    if (consumed.has(occurrence) || isOffsetInRanges(occurrence.start, lexed.comments)) continue
    if (
      lexed.strings.some((token) => occurrence.start >= token.start && occurrence.end <= token.end)
    ) {
      continue
    }
    if (!context.hasValue(occurrence.name)) continue
    const position = classifyPythonBarePlaceholder(input.code, occurrence, [
      ...lexed.strings.map(({ start, end }) => [start, end] as [number, number]),
      ...lexed.comments,
    ])
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

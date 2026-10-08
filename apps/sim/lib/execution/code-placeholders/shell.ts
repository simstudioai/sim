import {
  applySourceEdits,
  CodePlaceholderCompileError,
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

interface HeredocDeclaration {
  operatorStart: number
  operatorEnd: number
  delimiter: string
  quoted: boolean
  stripTabs: boolean
  bodyStart: number
  bodyEnd: number
  removalEnd: number
}

type ShellQuote = 'none' | 'single' | 'double' | 'ansi'

interface ShellScanFrame {
  kind: 'root' | 'command' | 'arithmetic' | 'backtick' | 'parameter'
  quote: ShellQuote
  parenthesisDepth: number
  bracketDepth?: number
  literalRoot: boolean
  inDoubleQuotes?: boolean
  commandStarted?: boolean
  commandPrefix?: 'time' | 'coproc'
  wordEnd?: number
  conditional?: {
    start: number
    arithmetic: boolean
    words: number
    wordOpen: boolean
    unary: boolean
  }
}

interface ShellOccurrenceContext {
  quote: ShellQuote
  /** Includes nested command substitutions whose output can become an arithmetic operand. */
  arithmetic?: boolean
  unsupported?: 'escaped sequence'
}

interface ShellSpan {
  start: number
  end: number
}

const ARITHMETIC_COMPARISON = /^-(?:eq|ne|lt|le|gt|ge)$/
const SHELL_WORD = /(?:\\[\s\S]|[^\s;&|()<>\\])+/y
const COMMAND_INTRODUCERS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
  '!',
  'time',
  'coproc',
])

function shellWordStarts(code: string, index: number): boolean {
  return index === 0 || /[\s;&|()<>]/.test(code[index - 1])
}

function followsRedirect(code: string, index: number): boolean {
  let previous = index - 1
  while (code[previous] === ' ' || code[previous] === '\t') previous -= 1
  return code[previous] === '<' || code[previous] === '>'
}

function effectiveQuote(frame: ShellScanFrame): ShellQuote {
  return frame.kind === 'parameter' && frame.quote === 'none' && frame.inDoubleQuotes
    ? 'double'
    : frame.quote
}

function readShellWord(code: string, index: number): { word: string; end: number } {
  SHELL_WORD.lastIndex = index
  const raw = SHELL_WORD.exec(code)?.[0] ?? ''
  return {
    word: raw.replace(/\\([\s\S])/g, (escaped, character) => (character === '\n' ? '' : escaped)),
    end: index + raw.length,
  }
}

function lineEndAfterNewline(code: string, start: number): number {
  const newline = code.indexOf('\n', start)
  return newline === -1 ? code.length : newline + 1
}

function logicalLineEndAfterContinuations(code: string, start: number): number {
  let end = lineEndAfterNewline(code, start)
  while (end < code.length) {
    let cursor = end - 2
    if (code[cursor] === '\r') cursor -= 1
    let backslashes = 0
    while (cursor >= start && code[cursor] === '\\') {
      backslashes += 1
      cursor -= 1
    }
    if (backslashes % 2 === 0) break
    end = lineEndAfterNewline(code, end)
  }
  return end
}

function shellCommentStarts(code: string, index: number): boolean {
  if (code[index] !== '#') return false
  const previous = code[index - 1]
  return previous === undefined || /\s|[;&|()<>]/.test(previous)
}

function shellArithmeticCommandStarts(code: string, index: number): boolean {
  if (code[index] !== '(' || code[index + 1] !== '(') return false
  const previous = code[index - 1]
  return previous === undefined || /\s|[;&|()<>]/.test(previous)
}

function decodeAnsiCCharacter(code: string, index: number): { value: string; end: number } {
  const character = code[index]
  const simple: Record<string, string> = {
    a: '\x07',
    b: '\b',
    e: '\x1b',
    E: '\x1b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    '\\': '\\',
    "'": "'",
    '"': '"',
  }
  if (Object.hasOwn(simple, character)) return { value: simple[character], end: index + 1 }

  const remainder = code.slice(index)
  const hexadecimal = /^(?:x([0-9A-Fa-f]{1,2})|u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8}))/.exec(remainder)
  if (hexadecimal) {
    const digits = hexadecimal[1] ?? hexadecimal[2] ?? hexadecimal[3]
    const codePoint = Number.parseInt(digits, 16)
    if (codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return { value: String.fromCodePoint(codePoint), end: index + hexadecimal[0].length }
    }
  }
  const octal = /^([0-7]{1,3})/.exec(remainder)
  if (octal) {
    return {
      value: String.fromCodePoint(Number.parseInt(octal[1], 8)),
      end: index + octal[0].length,
    }
  }
  if (character === 'c' && code[index + 1] !== undefined) {
    return {
      value: String.fromCodePoint(code[index + 1].toUpperCase().codePointAt(0)! & 0x1f),
      end: index + 2,
    }
  }
  return { value: `\\${character}`, end: index + 1 }
}

function readHeredocDelimiterWord(
  code: string,
  start: number,
  end: number
): { delimiter: string; quoted: boolean; end: number } | undefined {
  let cursor = start
  let delimiter = ''
  let quoted = false
  let consumed = false

  while (cursor < end) {
    const character = code[cursor]
    if (/\s|[;&|()<>]/.test(character)) break
    consumed = true

    if (character === '\\') {
      if (code[cursor + 1] === '\n') {
        cursor += 2
        continue
      }
      if (code[cursor + 1] === '\r' && code[cursor + 2] === '\n') {
        cursor += 3
        continue
      }
      quoted = true
      if (cursor + 1 < end) {
        delimiter += code[cursor + 1]
        cursor += 2
        continue
      }
      cursor += 1
      continue
    }

    const dollarQuoted = character === '$' && (code[cursor + 1] === "'" || code[cursor + 1] === '"')
    if (character === "'" || character === '"' || dollarQuoted) {
      const quote = dollarQuoted ? code[cursor + 1] : character
      const ansi = dollarQuoted && quote === "'"
      quoted = true
      cursor += dollarQuoted ? 2 : 1
      let closed = false
      while (cursor < end) {
        const current = code[cursor]
        if (current === quote) {
          cursor += 1
          closed = true
          break
        }
        if (ansi && current === '\\' && cursor + 1 < end) {
          const decoded = decodeAnsiCCharacter(code, cursor + 1)
          delimiter += decoded.value
          cursor = decoded.end
          continue
        }
        if (quote === '"' && current === '\\' && cursor + 1 < end) {
          const next = code[cursor + 1]
          if (next === '\n') {
            cursor += 2
            continue
          }
          if (next === '\r' && code[cursor + 2] === '\n') {
            cursor += 3
            continue
          }
          if (next === '$' || next === '`' || next === '"' || next === '\\') {
            delimiter += next
            cursor += 2
            continue
          }
        }
        delimiter += current
        cursor += 1
      }
      if (!closed) {
        throw new CodePlaceholderCompileError('Unterminated shell heredoc delimiter', code, start)
      }
      continue
    }

    delimiter += character
    cursor += 1
  }

  return consumed ? { delimiter, quoted, end: cursor } : undefined
}

function parseHeredocHeaders(
  code: string,
  lineStart: number,
  lineEnd: number,
  frames: ShellScanFrame[]
): Array<Omit<HeredocDeclaration, 'bodyStart' | 'bodyEnd' | 'removalEnd'>> {
  const declarations: Array<Omit<HeredocDeclaration, 'bodyStart' | 'bodyEnd' | 'removalEnd'>> = []
  for (let index = lineStart; index < lineEnd; index += 1) {
    const frame = frames.at(-1)
    if (!frame) break
    const character = code[index]
    if (frame.quote === 'single') {
      if (character === "'") frame.quote = 'none'
      continue
    }
    if (frame.quote === 'ansi') {
      if (character === '\\') index += 1
      else if (character === "'") frame.quote = 'none'
      continue
    }
    if (frame.quote === 'double') {
      if (character === '\\') index += 1
      else if (character === '"') frame.quote = 'none'
      else if (character === '$' && code[index + 1] === '(' && code[index + 2] === '(') {
        frames.push({
          kind: 'arithmetic',
          quote: 'none',
          parenthesisDepth: 2,
          literalRoot: false,
        })
        index += 2
      } else if (character === '$' && code[index + 1] === '(') {
        frames.push({
          kind: 'command',
          quote: 'none',
          parenthesisDepth: 1,
          literalRoot: false,
        })
        index += 1
      } else if (character === '`') {
        frames.push({
          kind: 'backtick',
          quote: 'none',
          parenthesisDepth: 0,
          literalRoot: false,
        })
      }
      continue
    }
    if (frame.kind === 'backtick' && character === '`') {
      frames.pop()
      continue
    }
    if (shellCommentStarts(code, index)) break
    if (character === '$' && code[index + 1] === "'") {
      frame.quote = 'ansi'
      index += 1
      continue
    }
    if (character === "'") {
      frame.quote = 'single'
      continue
    }
    if (character === '"') {
      frame.quote = 'double'
      continue
    }
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '$' && code[index + 1] === '(' && code[index + 2] === '(') {
      frames.push({
        kind: 'arithmetic',
        quote: 'none',
        parenthesisDepth: 2,
        literalRoot: false,
      })
      index += 2
      continue
    }
    if (shellArithmeticCommandStarts(code, index)) {
      frames.push({
        kind: 'arithmetic',
        quote: 'none',
        parenthesisDepth: 2,
        literalRoot: false,
      })
      index += 1
      continue
    }
    if (character === '$' && code[index + 1] === '(') {
      frames.push({
        kind: 'command',
        quote: 'none',
        parenthesisDepth: 1,
        literalRoot: false,
      })
      index += 1
      continue
    }
    if (character === '`') {
      frames.push({
        kind: 'backtick',
        quote: 'none',
        parenthesisDepth: 0,
        literalRoot: false,
      })
      continue
    }
    if ((frame.kind === 'command' || frame.kind === 'arithmetic') && character === '(') {
      frame.parenthesisDepth += 1
      continue
    }
    if ((frame.kind === 'command' || frame.kind === 'arithmetic') && character === ')') {
      frame.parenthesisDepth -= 1
      if (frame.parenthesisDepth === 0) frames.pop()
      continue
    }
    if (frame.kind === 'arithmetic') continue
    if (character !== '<' || code[index + 1] !== '<' || code[index + 2] === '<') continue

    const operatorStart = index
    let cursor = index + 2
    const stripTabs = code[cursor] === '-'
    if (stripTabs) cursor += 1
    while (cursor < lineEnd && (code[cursor] === ' ' || code[cursor] === '\t')) cursor += 1
    const word = readHeredocDelimiterWord(code, cursor, lineEnd)
    if (!word) continue
    cursor = word.end
    declarations.push({
      operatorStart,
      operatorEnd: cursor,
      delimiter: word.delimiter,
      quoted: word.quoted,
      stripTabs,
    })
    index = cursor - 1
  }
  return declarations
}

/**
 * Indexes every line by its terminator-comparable text, so a heredoc's terminator is found by
 * bisection. An unterminated header is skipped and parsing resumes on the next line, so walking
 * forward to the end of the file per header is quadratic in a file of unterminated headers.
 */
function createHeredocTerminatorLookup(
  code: string
): (delimiter: string, stripTabs: boolean, from: number) => number | undefined {
  const lineStartsByText = new Map<string, number[]>()
  const lineStartsByTabStrippedText = new Map<string, number[]>()
  const record = (index: Map<string, number[]>, text: string, lineStart: number) => {
    const lineStarts = index.get(text)
    if (lineStarts) lineStarts.push(lineStart)
    else index.set(text, [lineStart])
  }
  for (let lineStart = 0; lineStart < code.length; ) {
    const lineEnd = lineEndAfterNewline(code, lineStart)
    const rawLine = code.slice(lineStart, lineEnd).replace(/\n$/, '').replace(/\r$/, '')
    record(lineStartsByText, rawLine, lineStart)
    record(lineStartsByTabStrippedText, rawLine.replace(/^\t+/, ''), lineStart)
    lineStart = lineEnd
  }

  return (delimiter, stripTabs, from) => {
    if (from >= code.length) return delimiter === '' ? from : undefined
    const lineStarts = (stripTabs ? lineStartsByTabStrippedText : lineStartsByText).get(delimiter)
    return lineStarts?.[partitionPoint(lineStarts, (lineStart) => lineStart < from)]
  }
}

function collectHeredocs(code: string): HeredocDeclaration[] {
  const declarations: HeredocDeclaration[] = []
  const frames: ShellScanFrame[] = [
    { kind: 'root', quote: 'none', parenthesisDepth: 0, literalRoot: false },
  ]
  let findTerminator: ReturnType<typeof createHeredocTerminatorLookup> | undefined
  let cursor = 0
  while (cursor < code.length) {
    const headerEnd = logicalLineEndAfterContinuations(code, cursor)
    const headers = parseHeredocHeaders(code, cursor, headerEnd, frames)
    if (headers.length === 0) {
      cursor = headerEnd
      continue
    }

    findTerminator ??= createHeredocTerminatorLookup(code)
    let bodyCursor = headerEnd
    let complete = true
    for (const header of headers) {
      const terminatorStart = findTerminator(header.delimiter, header.stripTabs, bodyCursor)
      if (terminatorStart === undefined) {
        complete = false
        break
      }
      const removalEnd = lineEndAfterNewline(code, terminatorStart)
      declarations.push({
        ...header,
        bodyStart: bodyCursor,
        bodyEnd: terminatorStart,
        removalEnd,
      })
      bodyCursor = removalEnd
    }
    cursor = complete ? bodyCursor : headerEnd
  }
  return declarations
}

function shellExpansion(name: string, quote: ShellQuote): string {
  const expansion = `\${${name}}`
  if (quote === 'double') return expansion
  if (quote === 'single') return `'"${expansion}"'`
  if (quote === 'ansi') return `'"${expansion}"$'`
  return expansion
}

function isLegacyShellPlaceholder(occurrence: CodePlaceholderOccurrence): boolean {
  const inner = occurrence.raw.slice(2, -2)
  return inner.trim() === occurrence.name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(occurrence.name)
}

function blankPreservingLines(value: string): string {
  return value.replace(/[^\r\n]/g, '')
}

function stripHeredocTabs(value: string): string {
  return value.replace(/(^|\n)\t+/g, '$1')
}

function preserveContinuationLines(value: string): string {
  return [...value.matchAll(/\r?\n/g)].map((match) => ` \\${match[0]}`).join('')
}

function isShellAssignmentName(code: string, occurrence: CodePlaceholderOccurrence): boolean {
  if (code[occurrence.end] !== '=') return false
  const previous = code[occurrence.start - 1]
  return previous === undefined || /\s|[;&|()]/.test(previous)
}

function getUnsupportedShellPosition(
  code: string,
  occurrence: CodePlaceholderOccurrence,
  context: ShellOccurrenceContext
): string | undefined {
  if (context.arithmetic) return 'in shell arithmetic'
  if (code[occurrence.start - 1] === '$') return 'immediately after "$"'
  if (context.quote !== 'none') return undefined

  const lineStart = Math.max(
    code.lastIndexOf('\n', occurrence.start - 1),
    code.lastIndexOf(';', occurrence.start - 1),
    code.lastIndexOf('&', occurrence.start - 1),
    code.lastIndexOf('|', occurrence.start - 1)
  )
  const prefix = code.slice(lineStart + 1, occurrence.start)
  if (/(?:^|\s)(?:for|select|function)\s*$/.test(prefix)) return 'as a shell parser name'
  if (/^\s*\(\)/.test(code.slice(occurrence.end))) return 'as a shell function name'
  return undefined
}

function heredocBodyRanges(heredocs: HeredocDeclaration[]): Array<[number, number]> {
  return heredocs.map((heredoc) => [heredoc.bodyStart, heredoc.removalEnd])
}

/**
 * Jumps over `skippedRanges` (sorted heredoc bodies, which bash reads as data) so body prose
 * cannot shift quote context; bodies that need contexts are scanned on their own with `literalRoot`.
 */
function collectShellOccurrenceContexts<T extends ShellSpan>(
  code: string,
  occurrences: readonly T[],
  start: number,
  end: number,
  literalRoot: boolean,
  skippedRanges: Array<[number, number]> = []
): Map<T, ShellOccurrenceContext> {
  const occurrenceByStart = new Map(
    occurrencesWithin(occurrences, start, end).map(
      (occurrence) => [occurrence.start, occurrence] as const
    )
  )
  const contexts = new Map<T, ShellOccurrenceContext>()
  const frames: ShellScanFrame[] = [
    { kind: 'root', quote: 'none', parenthesisDepth: 0, literalRoot },
  ]
  let skippedRangeIndex = 0
  let arithmeticDepth = 0
  const conditionalArithmeticRanges: Array<[number, number]> = []
  const endConditionalOperand = (frame: ShellScanFrame, end: number) => {
    if (frame.conditional?.arithmetic) {
      conditionalArithmeticRanges.push([frame.conditional.start, end])
    }
    if (frame.conditional) {
      frame.conditional = { start: end, arithmetic: false, words: 0, wordOpen: false, unary: false }
    }
  }

  for (let index = start; index < end; ) {
    const frame = frames.at(-1)
    if (!frame) break

    while (
      skippedRangeIndex < skippedRanges.length &&
      skippedRanges[skippedRangeIndex][1] <= index
    ) {
      skippedRangeIndex += 1
    }
    const skippedRange = skippedRanges.at(skippedRangeIndex)
    if (skippedRange && index >= skippedRange[0]) {
      index = skippedRange[1]
      continue
    }

    const character = code[index]
    if (
      frame.quote === 'none' &&
      !frame.literalRoot &&
      frame.kind !== 'arithmetic' &&
      frame.kind !== 'parameter'
    ) {
      if (frame.conditional) {
        if (character === '\\' && code[index + 1] === '\n') {
          index += 2
          continue
        }
        if ((character === '&' || character === '|') && code[index + 1] === character) {
          endConditionalOperand(frame, index)
        }
        if (/\s|[()]/.test(character)) {
          frame.conditional.wordOpen = false
        } else if (!frame.conditional.wordOpen && character !== '&' && character !== '|') {
          const { word } = readShellWord(code, index)
          if (word === ']]') {
            endConditionalOperand(frame, index)
            frame.conditional = undefined
          } else {
            const conditional = frame.conditional
            conditional.wordOpen = true
            if (word !== '!' || conditional.words > 0) {
              if (
                conditional.words === 1 &&
                !conditional.unary &&
                word &&
                ARITHMETIC_COMPARISON.test(word)
              ) {
                conditional.arithmetic = true
              }
              if (conditional.words === 0) conditional.unary = /^-[a-zA-Z]$/.test(word ?? '')
              conditional.words += 1
            }
          }
        }
      } else if (
        /[\n;()]/.test(character) ||
        ((character === '&' || character === '|') &&
          !/[<>]/.test(code[index - 1] ?? '') &&
          !(character === '&' && code[index + 1] === '>')) ||
        (character === '{' &&
          shellWordStarts(code, index) &&
          readShellWord(code, index).word === '{')
      ) {
        frame.commandStarted = false
        frame.commandPrefix = undefined
      } else if (
        !frame.commandStarted &&
        index >= (frame.wordEnd ?? start) &&
        shellWordStarts(code, index)
      ) {
        const { word, end: wordEnd } = readShellWord(code, index)
        frame.wordEnd = wordEnd
        if (
          word &&
          !followsRedirect(code, index) &&
          !/^\d+(?=[<>])/.test(code.slice(index)) &&
          !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
        ) {
          const prefixArgument =
            (frame.commandPrefix === 'time' && word === '-p') ||
            (frame.commandPrefix === 'coproc' && word !== '[[' && !COMMAND_INTRODUCERS.has(word))
          frame.commandPrefix = word === 'time' || word === 'coproc' ? word : undefined
          if (!COMMAND_INTRODUCERS.has(word) && !prefixArgument) {
            frame.commandStarted = true
            if (word === '[[') {
              frame.conditional = {
                start: index,
                arithmetic: false,
                words: 0,
                wordOpen: true,
                unary: false,
              }
            }
          }
        }
      }
    }
    const occurrence = occurrenceByStart.get(index)
    if (occurrence) {
      contexts.set(occurrence, { quote: effectiveQuote(frame), arithmetic: arithmeticDepth > 0 })
      index = occurrence.end
      continue
    }
    if (
      character === '$' &&
      code[index + 1] === '{' &&
      !occurrenceByStart.has(index + 1) &&
      frame.kind !== 'arithmetic' &&
      (frame.quote === 'none' || frame.quote === 'double')
    ) {
      frames.push({
        kind: 'parameter',
        quote: 'none',
        parenthesisDepth: 0,
        literalRoot: false,
        inDoubleQuotes: effectiveQuote(frame) === 'double' || frame.literalRoot,
      })
      index += 2
      continue
    }
    if (frame.quote === 'single') {
      if (character === "'") frame.quote = 'none'
      index += 1
      continue
    }
    if (frame.quote === 'ansi') {
      if (character === '\\') {
        const escaped = occurrenceByStart.get(index + 1)
        if (escaped) {
          contexts.set(escaped, { quote: frame.quote, unsupported: 'escaped sequence' })
          index = escaped.end
        } else {
          index += 2
        }
      } else {
        if (character === "'") frame.quote = 'none'
        index += 1
      }
      continue
    }
    const arithmeticExpansion =
      character === '$' &&
      ((code[index + 1] === '(' && code[index + 2] === '(') || code[index + 1] === '[')
    const arithmeticCommand =
      frame.quote === 'none' &&
      !frame.literalRoot &&
      frame.kind !== 'parameter' &&
      shellArithmeticCommandStarts(code, index)
    if (arithmeticExpansion || arithmeticCommand) {
      const brackets = arithmeticExpansion && code[index + 1] === '['
      frames.push({
        kind: 'arithmetic',
        quote: 'none',
        parenthesisDepth: brackets ? 0 : 2,
        ...(brackets ? { bracketDepth: 1 } : {}),
        literalRoot: false,
      })
      arithmeticDepth += 1
      index += arithmeticExpansion && !brackets ? 3 : 2
      continue
    }
    if (frame.quote === 'double') {
      if (character === '\\') {
        const escaped = occurrenceByStart.get(index + 1)
        if (escaped) {
          contexts.set(escaped, { quote: frame.quote, unsupported: 'escaped sequence' })
          index = escaped.end
        } else {
          index += 2
        }
      } else if (character === '"') {
        frame.quote = 'none'
        index += 1
      } else if (character === '$' && code[index + 1] === '(') {
        frames.push({
          kind: 'command',
          quote: 'none',
          parenthesisDepth: 1,
          literalRoot: false,
        })
        index += 2
      } else if (character === '`') {
        frames.push({
          kind: 'backtick',
          quote: 'none',
          parenthesisDepth: 0,
          literalRoot: false,
        })
        index += 1
      } else {
        index += 1
      }
      continue
    }

    if (frame.kind === 'backtick' && character === '`') {
      frames.pop()
      index += 1
      continue
    }
    if (
      frame.kind !== 'arithmetic' &&
      frame.kind !== 'parameter' &&
      !frame.literalRoot &&
      shellCommentStarts(code, index)
    ) {
      if (!frame.conditional) frame.commandStarted = false
      const newline = code.indexOf('\n', index)
      index = newline === -1 || newline >= end ? end : newline + 1
      continue
    }
    if (character === '\\') {
      const escaped = occurrenceByStart.get(index + 1)
      if (escaped) {
        contexts.set(escaped, { quote: frame.quote, unsupported: 'escaped sequence' })
        index = escaped.end
      } else {
        index += 2
      }
      continue
    }
    const singleQuotesLiteral = frame.kind === 'parameter' && frame.inDoubleQuotes
    if (
      !frame.literalRoot &&
      !singleQuotesLiteral &&
      character === '$' &&
      code[index + 1] === "'"
    ) {
      frame.quote = 'ansi'
      index += 2
      continue
    }
    if (!frame.literalRoot && !singleQuotesLiteral && character === "'") {
      frame.quote = 'single'
      index += 1
      continue
    }
    if (!frame.literalRoot && character === '"') {
      frame.quote = 'double'
      index += 1
      continue
    }
    if (character === '$' && code[index + 1] === '(') {
      frames.push({
        kind: 'command',
        quote: 'none',
        parenthesisDepth: 1,
        literalRoot: false,
      })
      index += 2
      continue
    }
    if (character === '`') {
      frames.push({
        kind: 'backtick',
        quote: 'none',
        parenthesisDepth: 0,
        literalRoot: false,
      })
      index += 1
      continue
    }
    if (frame.kind === 'parameter' && character === '}') {
      frames.pop()
      index += 1
      continue
    }
    if (frame.kind === 'arithmetic' && frame.bracketDepth !== undefined) {
      if (character === '[') frame.bracketDepth += 1
      if (character === ']') {
        frame.bracketDepth -= 1
        if (frame.bracketDepth === 0) {
          frames.pop()
          arithmeticDepth -= 1
        }
      }
      index += 1
      continue
    }
    if ((frame.kind === 'command' || frame.kind === 'arithmetic') && character === '(') {
      frame.parenthesisDepth += 1
      index += 1
      continue
    }
    if ((frame.kind === 'command' || frame.kind === 'arithmetic') && character === ')') {
      frame.parenthesisDepth -= 1
      if (frame.parenthesisDepth === 0) {
        frames.pop()
        if (frame.kind === 'arithmetic') arithmeticDepth -= 1
      }
      index += 1
      continue
    }
    index += 1
  }

  for (const frame of frames) endConditionalOperand(frame, end)
  const inConditionalArithmetic = createOffsetRangeLookup(conditionalArithmeticRanges)
  for (const [occurrence, context] of contexts) {
    if (inConditionalArithmetic(occurrence.start)) context.arithmetic = true
  }
  return contexts
}

/**
 * Whether the character at `index` is escaped: an odd run of backslashes immediately before it.
 *
 * Parity, not presence — `\\$KEY` is an escaped backslash followed by a live expansion, so
 * checking only the adjacent character reads a real read as escaped and drops it from usage
 * and masking alike. The same rule already decides line continuations in
 * {@link logicalLineEndAfterContinuations}.
 */
function isBackslashEscaped(code: string, index: number): boolean {
  let backslashes = 0
  let cursor = index - 1
  while (cursor >= 0 && code[cursor] === '\\') {
    backslashes += 1
    cursor -= 1
  }
  return backslashes % 2 === 1
}

/** `$NAME` and `${NAME}` — including `${NAME:-default}`, whose name still ends at `:`. */
const SHELL_PARAMETER_EXPANSION = /\$(?:\{\s*([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/g

function recordShellDirectEnvironmentReads(
  code: string,
  context: CodePlaceholderCompilationContext
): void {
  /**
   * The regex runs before anything else so a script with no expansion at all — or none naming
   * a configured secret — costs one scan and returns, rather than paying for the heredoc and
   * quote passes below. This function runs ahead of the no-placeholder early return, so that
   * cheap path has to stay cheap.
   */
  const matches: RegExpExecArray[] = []
  SHELL_PARAMETER_EXPANSION.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SHELL_PARAMETER_EXPANSION.exec(code)) !== null) {
    if (isBackslashEscaped(code, match.index)) continue
    const name = match[1] ?? match[2]
    if (name && context.tracksDirectEnvironmentRead(name)) matches.push(match)
  }
  if (matches.length === 0) return

  const candidates = matches.map(
    (candidate): CodePlaceholderOccurrence => ({
      start: candidate.index,
      end: candidate.index + candidate[0].length,
      raw: candidate[0],
      name: (candidate[1] ?? candidate[2]) as string,
    })
  )

  const heredocs = collectHeredocs(code)
  const contexts = collectShellOccurrenceContexts(
    code,
    candidates,
    0,
    code.length,
    false,
    heredocBodyRanges(heredocs)
  )
  /**
   * A heredoc with a quoted delimiter (`<<'EOF'`) is literal, so nothing in its body expands
   * and its candidates stay contextless — a usage trail must not claim uses that did not occur.
   */
  for (const heredoc of heredocs) {
    if (heredoc.quoted) continue
    const bodyContexts = collectShellOccurrenceContexts(
      code,
      candidates,
      heredoc.bodyStart,
      heredoc.bodyEnd,
      true
    )
    for (const [candidate, shellContext] of bodyContexts) contexts.set(candidate, shellContext)
  }
  for (const candidate of candidates) {
    const shellContext = contexts.get(candidate)
    /**
     * No context means the scanner never reached this offset — it skipped the region as a
     * comment or a quoted heredoc body. Absence is therefore evidence the expansion does not
     * run, not permission to record it, so this reads as an allowlist rather than a denylist.
     * Single quotes suppress expansion outright.
     */
    if (!shellContext || shellContext.quote === 'single') continue
    context.recordDirectEnvironmentRead(candidate.name, candidate.start)
  }
}

/**
 * Binds values without inserting them into shell source, rejecting placeholders in explicit
 * arithmetic delimiters and arithmetic comparisons. This lexical guard does not follow later
 * evaluation through variable attributes, indirect command names, or commands such as `eval`.
 */
export async function compileShellPlaceholders(
  input: InternalCompileCodePlaceholdersInput
): Promise<CompiledCodePlaceholders> {
  const context = createCodePlaceholderCompilationContext(input)
  recordShellDirectEnvironmentReads(input.code, context)
  if (context.occurrences.length === 0) return context.finish(input.code)

  const validateShellValue = <T extends { value: string } | undefined>(
    occurrence: CodePlaceholderOccurrence,
    resolved: T
  ): T => {
    if (resolved?.value.includes('\0')) {
      throw new CodePlaceholderCompileError(
        `Variable placeholder "${occurrence.name}" cannot contain NUL in shell code`,
        input.code,
        occurrence.start
      )
    }
    return resolved
  }
  const resolveShellOccurrence = (occurrence: CodePlaceholderOccurrence) =>
    validateShellValue(occurrence, context.resolve(occurrence))
  const resolveShellValue = (occurrence: CodePlaceholderOccurrence) =>
    validateShellValue(occurrence, context.resolveValue(occurrence))
  /** A placeholder with no value stays as written; analysis still discovers one with a value. */
  const rejectUnsupported = (occurrence: CodePlaceholderOccurrence, position: string) => {
    if (!context.hasValue(occurrence.name)) return
    if (input.analysisOnly) {
      context.resolveValue(occurrence)
      return
    }
    throw new CodePlaceholderCompileError(
      `Variable placeholder "${occurrence.name}" is not supported ${position}`,
      input.code,
      occurrence.start
    )
  }
  /** Heredoc bodies are data, so only code outside them can name an assignment target. */
  const resolveInContext = (
    occurrence: CodePlaceholderOccurrence,
    occurrenceContext: ShellOccurrenceContext | undefined,
    inCode: boolean
  ): SourceEdit | undefined => {
    if (!occurrenceContext) return undefined
    if (occurrenceContext.unsupported) {
      rejectUnsupported(occurrence, 'in an escaped shell sequence')
      return undefined
    }
    const unsupportedPosition =
      getUnsupportedShellPosition(input.code, occurrence, occurrenceContext) ??
      (inCode && occurrenceContext.quote === 'none' && isShellAssignmentName(input.code, occurrence)
        ? 'as a shell assignment name'
        : undefined)
    if (unsupportedPosition) {
      rejectUnsupported(occurrence, unsupportedPosition)
      return undefined
    }
    const resolved = resolveShellOccurrence(occurrence)
    return {
      start: occurrence.start,
      end: occurrence.end,
      text: resolved ? shellExpansion(resolved.bindingName, occurrenceContext.quote) : '',
    }
  }

  const heredocs = collectHeredocs(input.code)
  const shellOccurrences = context.occurrences.filter(isLegacyShellPlaceholder)
  const isExcluded = createOffsetRangeLookup(
    heredocs.flatMap(
      (heredoc): Array<[number, number]> => [
        [heredoc.operatorStart, heredoc.operatorEnd],
        [heredoc.bodyStart, heredoc.removalEnd],
      ]
    )
  )
  const rootOccurrences = shellOccurrences.filter((occurrence) => !isExcluded(occurrence.start))
  /** A heredoc operator's context is where its body lands, so it is scanned like a placeholder. */
  const heredocOperators = heredocs.map(
    (heredoc): ShellSpan => ({ start: heredoc.operatorStart, end: heredoc.operatorEnd })
  )
  const rootContexts = collectShellOccurrenceContexts<ShellSpan>(
    input.code,
    [...rootOccurrences, ...heredocOperators].sort((left, right) => left.start - right.start),
    0,
    input.code.length,
    false,
    heredocBodyRanges(heredocs)
  )
  const edits: SourceEdit[] = []

  for (const [heredocIndex, heredoc] of heredocs.entries()) {
    const delimiterOccurrences = occurrencesWithin(
      shellOccurrences,
      heredoc.operatorStart,
      heredoc.operatorEnd
    )
    for (const occurrence of delimiterOccurrences) {
      rejectUnsupported(occurrence, 'in a shell heredoc delimiter')
    }

    const bodyOccurrences = occurrencesWithin(shellOccurrences, heredoc.bodyStart, heredoc.bodyEnd)
    if (rootContexts.get(heredocOperators[heredocIndex])?.arithmetic) {
      for (const occurrence of bodyOccurrences) rejectUnsupported(occurrence, 'in shell arithmetic')
      continue
    }
    if (heredoc.quoted) {
      const bodyEdits: SourceEdit[] = []
      let hasResolvedPlaceholder = false
      for (const occurrence of bodyOccurrences) {
        const resolved = resolveShellValue(occurrence)
        bodyEdits.push({
          start: occurrence.start - heredoc.bodyStart,
          end: occurrence.end - heredoc.bodyStart,
          text: resolved?.value ?? '',
        })
        if (resolved) hasResolvedPlaceholder = true
      }
      if (bodyEdits.length === 0) continue
      if (!hasResolvedPlaceholder) {
        edits.push(
          ...bodyEdits.map((edit) => ({
            ...edit,
            start: edit.start + heredoc.bodyStart,
            end: edit.end + heredoc.bodyStart,
          }))
        )
        continue
      }
      let content = applySourceEdits(
        input.code.slice(heredoc.bodyStart, heredoc.bodyEnd),
        bodyEdits
      )
      if (heredoc.stripTabs) content = stripHeredocTabs(content)
      const privateInput = context.createPrivateInput(content)
      edits.push({
        start: heredoc.operatorStart,
        end: heredoc.operatorEnd,
        text: `< "\${${privateInput.environmentVariable}}"${preserveContinuationLines(input.code.slice(heredoc.operatorStart, heredoc.operatorEnd))}`,
      })
      edits.push({
        start: heredoc.bodyStart,
        end: heredoc.removalEnd,
        text: blankPreservingLines(input.code.slice(heredoc.bodyStart, heredoc.removalEnd)),
      })
      continue
    }

    const bodyContexts = collectShellOccurrenceContexts(
      input.code,
      bodyOccurrences,
      heredoc.bodyStart,
      heredoc.bodyEnd,
      true
    )
    for (const occurrence of bodyOccurrences) {
      const edit = resolveInContext(occurrence, bodyContexts.get(occurrence), false)
      if (edit) edits.push(edit)
    }
  }

  for (const occurrence of rootOccurrences) {
    const edit = resolveInContext(occurrence, rootContexts.get(occurrence), true)
    if (edit) edits.push(edit)
  }

  return context.finish(applySourceEdits(input.code, edits))
}

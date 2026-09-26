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
  kind: 'root' | 'command' | 'arithmetic' | 'backtick' | 'array' | 'conditional'
  quote: ShellQuote
  parenthesisDepth: number
  bracketDepth?: number
  /** Some operands become arithmetic only after a following assignment or comparison operator. */
  arithmeticEnabled?: boolean
  arithmeticParent?: ShellScanFrame
  conditional?: {
    parent?: ShellScanFrame
    previousOperand?: ShellScanFrame
    word?: ShellScanFrame
    numericOperand: boolean
  }
  wordStart?: number
  commandPosition?: boolean
  declarationCommand?: boolean
  redirectionTarget?: boolean
  literalRoot: boolean
}

interface ShellOccurrenceContext {
  quote: ShellQuote
  /**
   * Enclosing arithmetic also re-evaluates nested substitutions. Keep a frame reference so a
   * bare subscript can be classified when its closing bracket confirms an assignment.
   */
  arithmeticFrame?: ShellScanFrame
  unsupported?: 'escaped sequence'
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

function pushShellFrame(frames: ShellScanFrame[], frame: ShellScanFrame): void {
  const parent = frames.at(-1)
  frame.arithmeticParent = parent?.kind === 'arithmetic' ? parent : parent?.arithmeticParent
  frames.push(frame)
}

function readShellExpansionStart(
  code: string,
  index: number,
  allowArithmeticCommand: boolean
): { frame: ShellScanFrame; length: number } | undefined {
  const dollar = code[index] === '$'
  const bracket = dollar && code[index + 1] === '['
  const arithmetic =
    bracket ||
    (dollar && code[index + 1] === '(' && code[index + 2] === '(') ||
    (allowArithmeticCommand && shellArithmeticCommandStarts(code, index))
  if (!arithmetic && !(dollar && code[index + 1] === '(')) return undefined

  return {
    frame: {
      kind: arithmetic ? 'arithmetic' : 'command',
      quote: 'none',
      parenthesisDepth: bracket ? 0 : arithmetic ? 2 : 1,
      ...(bracket ? { bracketDepth: 1 } : {}),
      literalRoot: false,
    },
    length: dollar && arithmetic && !bracket ? 3 : 2,
  }
}

function readShellArrayStart(
  code: string,
  index: number,
  parent: ShellScanFrame
): ShellScanFrame | undefined {
  const character = code[index]
  if (character !== '[' && character !== '(') return undefined

  let nameEnd = index
  if (character === '(') {
    if (code[index - 1] !== '=') return undefined
    nameEnd -= 1
    if (code[nameEnd - 1] === '+') nameEnd -= 1
  }
  let nameStart = nameEnd
  while (nameStart > 0 && /[A-Za-z0-9_]/.test(code[nameStart - 1])) nameStart -= 1
  const hasName = nameStart < nameEnd && /[A-Za-z_]/.test(code[nameStart])
  const parameterStart =
    code[nameStart - 1] === '#' || code[nameStart - 1] === '!' ? nameStart - 3 : nameStart - 2
  const parameter =
    character === '[' &&
    hasName &&
    code.slice(parameterStart, parameterStart + 2) === '${' &&
    !isBackslashEscaped(code, parameterStart)
  const wordStart = nameStart === 0 || /\s|[;&|()]/.test(code[nameStart - 1])
  const assignment =
    parent.quote === 'none' &&
    !parent.literalRoot &&
    parent.kind !== 'conditional' &&
    wordStart &&
    (parent.kind === 'array' || parent.commandPosition !== false || parent.declarationCommand) &&
    (hasName || (character === '[' && parent.kind === 'array'))
  if (!parameter && !assignment) return undefined

  return {
    kind: character === '[' ? 'arithmetic' : 'array',
    quote: 'none',
    parenthesisDepth: character === '(' ? 1 : 0,
    ...(character === '['
      ? { bracketDepth: 1, ...(!parameter ? { arithmeticEnabled: false } : {}) }
      : {}),
    literalRoot: false,
  }
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

/** Assignment-shaped words after an ordinary command name are arguments, not arithmetic. */
function trackShellCommandPosition(code: string, index: number, frame: ShellScanFrame): void {
  if (
    frame.literalRoot ||
    frame.quote !== 'none' ||
    (frame.kind !== 'root' && frame.kind !== 'command' && frame.kind !== 'backtick')
  ) {
    return
  }
  const character = code[index]
  const redirection = character === '<' || character === '>' || code.startsWith('&>', index)
  const separator =
    /[;\n&|()]/.test(character) &&
    !redirection &&
    !((character === '&' || character === '|') && /[<>]/.test(code[index - 1] ?? ''))
  if (!separator && !redirection && !/\s/.test(character)) {
    if (character === '\\' && /^\r?\n/.test(code.slice(index + 1, index + 3))) return
    frame.wordStart ??= index
    return
  }

  if (frame.wordStart !== undefined) {
    const word = code.slice(frame.wordStart, index).replace(/\\\r?\n/g, '')
    if (frame.redirectionTarget) {
      frame.redirectionTarget = false
    } else if (
      !(redirection && /^\d+$/.test(word)) &&
      frame.commandPosition !== false &&
      !/^[A-Za-z_][A-Za-z0-9_]*(?:\+?=|\[[\s\S]*\]\+?=)/.test(word) &&
      !/^(?:if|then|else|elif|while|until|do|!|\{|time|command|builtin|exec)$/.test(word)
    ) {
      frame.commandPosition = false
      const name = readHeredocDelimiterWord(word, 0, word.length)?.delimiter
      frame.declarationCommand = /^(?:declare|export|local|readonly|typeset)$/.test(name ?? '')
    }
    frame.wordStart = undefined
  }
  if (separator) {
    frame.commandPosition = true
    frame.declarationCommand = false
    frame.redirectionTarget = false
  } else if (redirection) {
    frame.redirectionTarget = true
  }
}

/** Keep operand contexts pending until the following conditional operator is known. */
function trackShellConditionalOperand(code: string, index: number, frame: ShellScanFrame): void {
  const conditional = frame.conditional
  if (!conditional || frame.quote !== 'none') return
  const character = code[index]
  const closing =
    frame.wordStart === undefined &&
    code.startsWith(']]', index) &&
    (index + 2 === code.length || /\s|[;&|()<>]/.test(code[index + 2]))
  const separator = /[&|()]/.test(character) || closing
  if (!separator && !/\s/.test(character)) {
    if (character === '\\' && /^\r?\n/.test(code.slice(index + 1, index + 3))) return
    if (frame.wordStart === undefined) {
      frame.wordStart = index
      conditional.word = {
        kind: 'arithmetic',
        quote: 'none',
        parenthesisDepth: 0,
        literalRoot: false,
        arithmeticEnabled: conditional.numericOperand,
        arithmeticParent: conditional.parent,
      }
      conditional.numericOperand = false
      frame.arithmeticParent = conditional.word
    }
    return
  }

  if (frame.wordStart !== undefined) {
    const word = code.slice(frame.wordStart, index).replace(/\\\r?\n/g, '')
    if (/^-(?:eq|ne|lt|le|gt|ge)$/.test(word)) {
      if (conditional.previousOperand) conditional.previousOperand.arithmeticEnabled = true
      conditional.numericOperand = true
    } else {
      conditional.previousOperand = conditional.word
    }
    frame.wordStart = undefined
    conditional.word = undefined
    frame.arithmeticParent = conditional.parent
  }
  if (separator) {
    conditional.previousOperand = undefined
    conditional.numericOperand = false
  }
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
    const expansion = readShellExpansionStart(
      code,
      index,
      frame.quote === 'none' && frame.kind !== 'arithmetic'
    )
    if (frame.quote === 'double') {
      if (character === '\\') index += 1
      else if (character === '"') frame.quote = 'none'
      else if (expansion) {
        pushShellFrame(frames, expansion.frame)
        index += expansion.length - 1
      } else if (character === '`') {
        pushShellFrame(frames, {
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
    if (expansion) {
      pushShellFrame(frames, expansion.frame)
      index += expansion.length - 1
      continue
    }
    if (character === '`') {
      pushShellFrame(frames, {
        kind: 'backtick',
        quote: 'none',
        parenthesisDepth: 0,
        literalRoot: false,
      })
      continue
    }
    if (frame.bracketDepth !== undefined) {
      if (character === '[') frame.bracketDepth += 1
      if (character === ']') {
        frame.bracketDepth -= 1
        if (frame.bracketDepth === 0) frames.pop()
      }
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

function collectHeredocs(code: string): HeredocDeclaration[] {
  const declarations: HeredocDeclaration[] = []
  const frames: ShellScanFrame[] = [
    { kind: 'root', quote: 'none', parenthesisDepth: 0, literalRoot: false },
  ]
  let cursor = 0
  while (cursor < code.length) {
    const headerEnd = logicalLineEndAfterContinuations(code, cursor)
    const headers = parseHeredocHeaders(code, cursor, headerEnd, frames)
    if (headers.length === 0) {
      cursor = headerEnd
      continue
    }

    let bodyCursor = headerEnd
    let complete = true
    for (const header of headers) {
      const bodyStart = bodyCursor
      let found = false
      while (bodyCursor <= code.length) {
        const candidateEnd = lineEndAfterNewline(code, bodyCursor)
        const rawLine = code.slice(bodyCursor, candidateEnd).replace(/\n$/, '').replace(/\r$/, '')
        const comparable = header.stripTabs ? rawLine.replace(/^\t+/, '') : rawLine
        if (comparable === header.delimiter) {
          declarations.push({
            ...header,
            bodyStart,
            bodyEnd: bodyCursor,
            removalEnd: candidateEnd,
          })
          bodyCursor = candidateEnd
          found = true
          break
        }
        if (candidateEnd === code.length) break
        bodyCursor = candidateEnd
      }
      if (!found) {
        complete = false
        break
      }
    }
    cursor = complete ? bodyCursor : headerEnd
  }
  return declarations
}

/** Delimiter words and complete bodies are data, not part of the enclosing shell's quote state. */
function heredocExcludedRanges(heredocs: HeredocDeclaration[]): Array<[number, number]> {
  return heredocs.flatMap((heredoc) => [
    [heredoc.operatorStart, heredoc.operatorEnd],
    [heredoc.bodyStart, heredoc.removalEnd],
  ])
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
  for (let frame = context.arithmeticFrame; frame; frame = frame.arithmeticParent) {
    if (frame.arithmeticEnabled !== false) return 'in a shell arithmetic expression'
  }
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

function collectShellOccurrenceContexts(
  code: string,
  occurrences: CodePlaceholderOccurrence[],
  start: number,
  end: number,
  literalRoot: boolean,
  excludedRanges: ReadonlyArray<readonly [number, number]> = []
): Map<CodePlaceholderOccurrence, ShellOccurrenceContext> {
  const excludedEndByStart = new Map(excludedRanges)
  const occurrenceByStart = new Map(
    occurrences
      .filter((occurrence) => occurrence.start >= start && occurrence.end <= end)
      .map((occurrence) => [occurrence.start, occurrence] as const)
  )
  const contexts = new Map<CodePlaceholderOccurrence, ShellOccurrenceContext>()
  const frames: ShellScanFrame[] = [
    { kind: 'root', quote: 'none', parenthesisDepth: 0, literalRoot },
  ]

  for (let index = start; index < end; ) {
    const excludedEnd = excludedEndByStart.get(index)
    if (excludedEnd !== undefined) {
      index = excludedEnd
      continue
    }
    const frame = frames.at(-1)
    if (!frame) break

    trackShellCommandPosition(code, index, frame)
    trackShellConditionalOperand(code, index, frame)
    const occurrence = occurrenceByStart.get(index)
    if (occurrence) {
      contexts.set(occurrence, {
        quote: frame.quote,
        arithmeticFrame: frame.kind === 'arithmetic' ? frame : frame.arithmeticParent,
      })
      index = occurrence.end
      continue
    }

    const character = code[index]
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
    const expansion = readShellExpansionStart(
      code,
      index,
      frame.quote === 'none' &&
        !frame.literalRoot &&
        frame.kind !== 'arithmetic' &&
        frame.kind !== 'conditional'
    )
    const array = readShellArrayStart(code, index, frame)
    if (array) {
      pushShellFrame(frames, array)
      index += 1
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
      } else if (expansion) {
        pushShellFrame(frames, expansion.frame)
        index += expansion.length
      } else if (character === '`') {
        pushShellFrame(frames, {
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
      frame.kind === 'conditional' &&
      frame.wordStart === undefined &&
      code.startsWith(']]', index)
    ) {
      frames.pop()
      index += 2
      continue
    }
    if (
      !frame.literalRoot &&
      frame.commandPosition !== false &&
      code.startsWith('[[', index) &&
      (index === 0 || /\s|[;&|()]/.test(code[index - 1])) &&
      (index + 2 === end || /\s|[()]/.test(code[index + 2]))
    ) {
      const conditional: ShellScanFrame = {
        kind: 'conditional',
        quote: 'none',
        parenthesisDepth: 0,
        literalRoot: false,
        conditional: { numericOperand: false },
      }
      pushShellFrame(frames, conditional)
      if (conditional.conditional) conditional.conditional.parent = conditional.arithmeticParent
      index += 2
      continue
    }
    if (!frame.literalRoot && shellCommentStarts(code, index)) {
      const newline = code.indexOf('\n', index)
      if (newline !== -1 && newline < end) trackShellCommandPosition(code, newline, frame)
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
    if (!frame.literalRoot && character === '$' && code[index + 1] === "'") {
      frame.quote = 'ansi'
      index += 2
      continue
    }
    if (!frame.literalRoot && character === "'") {
      frame.quote = 'single'
      index += 1
      continue
    }
    if (!frame.literalRoot && character === '"') {
      frame.quote = 'double'
      index += 1
      continue
    }
    if (expansion) {
      pushShellFrame(frames, expansion.frame)
      index += expansion.length
      continue
    }
    if (character === '`') {
      pushShellFrame(frames, {
        kind: 'backtick',
        quote: 'none',
        parenthesisDepth: 0,
        literalRoot: false,
      })
      index += 1
      continue
    }
    if (frame.bracketDepth !== undefined) {
      if (character === '[') frame.bracketDepth += 1
      if (character === ']') {
        frame.bracketDepth -= 1
        if (frame.bracketDepth === 0) {
          if (frame.arithmeticEnabled !== undefined) {
            frame.arithmeticEnabled = code[index + 1] === '=' || code.startsWith('+=', index + 1)
          }
          frames.pop()
        }
      }
      index += 1
      continue
    }
    if (
      (frame.kind === 'command' || frame.kind === 'arithmetic' || frame.kind === 'array') &&
      character === '('
    ) {
      frame.parenthesisDepth += 1
      index += 1
      continue
    }
    if (
      (frame.kind === 'command' || frame.kind === 'arithmetic' || frame.kind === 'array') &&
      character === ')'
    ) {
      frame.parenthesisDepth -= 1
      if (frame.parenthesisDepth === 0) frames.pop()
      index += 1
      continue
    }
    index += 1
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

  const heredocs = collectHeredocs(code)
  const candidates = matches.map(
    (candidate): CodePlaceholderOccurrence => ({
      start: candidate.index,
      end: candidate.index + candidate[0].length,
      raw: candidate[0],
      name: (candidate[1] ?? candidate[2]) as string,
    })
  )
  const contexts = collectShellOccurrenceContexts(
    code,
    candidates,
    0,
    code.length,
    false,
    heredocExcludedRanges(heredocs)
  )
  /** Unquoted bodies expand parameters, but prose quotes and comment markers remain literal. */
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
    /** Comments, delimiter words, literal bodies and single-quoted strings do not expand. */
    if (!shellContext || shellContext.quote === 'single') continue
    context.recordDirectEnvironmentRead(candidate.name, candidate.start)
  }
}

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

  const heredocs = collectHeredocs(input.code)
  const shellOccurrences = context.occurrences.filter(isLegacyShellPlaceholder)
  const edits: SourceEdit[] = []
  const excludedRanges = heredocExcludedRanges(heredocs)

  for (const heredoc of heredocs) {
    const delimiterOccurrences = shellOccurrences.filter(
      (occurrence) =>
        occurrence.start >= heredoc.operatorStart && occurrence.end <= heredoc.operatorEnd
    )
    for (const occurrence of delimiterOccurrences) {
      if (context.hasValue(occurrence.name)) {
        if (input.analysisOnly) {
          context.resolveValue(occurrence)
          continue
        }
        throw new CodePlaceholderCompileError(
          `Variable placeholder "${occurrence.name}" is not supported in a shell heredoc delimiter`,
          input.code,
          occurrence.start
        )
      }
    }

    const bodyOccurrences = shellOccurrences.filter(
      (occurrence) => occurrence.start >= heredoc.bodyStart && occurrence.end <= heredoc.bodyEnd
    )
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
      const occurrenceContext = bodyContexts.get(occurrence)
      if (!occurrenceContext) continue
      if (occurrenceContext.unsupported) {
        if (context.hasValue(occurrence.name)) {
          if (input.analysisOnly) {
            context.resolveValue(occurrence)
            continue
          }
          throw new CodePlaceholderCompileError(
            `Variable placeholder "${occurrence.name}" is not supported in an escaped shell sequence`,
            input.code,
            occurrence.start
          )
        }
        continue
      }
      const unsupportedPosition = getUnsupportedShellPosition(
        input.code,
        occurrence,
        occurrenceContext
      )
      if (unsupportedPosition) {
        if (context.hasValue(occurrence.name)) {
          if (input.analysisOnly) {
            context.resolveValue(occurrence)
            continue
          }
          throw new CodePlaceholderCompileError(
            `Variable placeholder "${occurrence.name}" is not supported ${unsupportedPosition}`,
            input.code,
            occurrence.start
          )
        }
        continue
      }
      const resolved = resolveShellOccurrence(occurrence)
      edits.push({
        start: occurrence.start,
        end: occurrence.end,
        text: resolved ? shellExpansion(resolved.bindingName, occurrenceContext.quote) : '',
      })
    }
  }

  const rootOccurrences = shellOccurrences.filter(
    (occurrence) => !isOffsetInRanges(occurrence.start, excludedRanges)
  )
  const rootContexts = collectShellOccurrenceContexts(
    input.code,
    rootOccurrences,
    0,
    input.code.length,
    false,
    excludedRanges
  )
  for (const occurrence of rootOccurrences) {
    const occurrenceContext = rootContexts.get(occurrence)
    if (!occurrenceContext) continue
    if (occurrenceContext.unsupported) {
      if (context.hasValue(occurrence.name)) {
        if (input.analysisOnly) {
          context.resolveValue(occurrence)
          continue
        }
        throw new CodePlaceholderCompileError(
          `Variable placeholder "${occurrence.name}" is not supported in an escaped shell sequence`,
          input.code,
          occurrence.start
        )
      }
      continue
    }
    const unsupportedPosition = getUnsupportedShellPosition(
      input.code,
      occurrence,
      occurrenceContext
    )
    if (unsupportedPosition) {
      if (context.hasValue(occurrence.name)) {
        if (input.analysisOnly) {
          context.resolveValue(occurrence)
          continue
        }
        throw new CodePlaceholderCompileError(
          `Variable placeholder "${occurrence.name}" is not supported ${unsupportedPosition}`,
          input.code,
          occurrence.start
        )
      }
      continue
    }
    if (occurrenceContext.quote === 'none' && isShellAssignmentName(input.code, occurrence)) {
      if (context.hasValue(occurrence.name)) {
        if (input.analysisOnly) {
          context.resolveValue(occurrence)
          continue
        }
        throw new CodePlaceholderCompileError(
          `Variable placeholder "${occurrence.name}" is not supported as a shell assignment name`,
          input.code,
          occurrence.start
        )
      }
      continue
    }
    const resolved = resolveShellOccurrence(occurrence)
    edits.push({
      start: occurrence.start,
      end: occurrence.end,
      text: resolved ? shellExpansion(resolved.bindingName, occurrenceContext.quote) : '',
    })
  }

  return context.finish(applySourceEdits(input.code, edits))
}

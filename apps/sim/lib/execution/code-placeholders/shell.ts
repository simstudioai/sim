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
  /**
   * `parameter` is a `${...}` expansion, which ends on its own `}`, not a command boundary.
   * `keysubscript` is an associative array's `[key]`, scanned like a subscript but not arithmetic.
   * `arrayliteral` is a compound assignment's `( … )`, where element keys `[k]=` are subscripts.
   * `subshell` is a bare `( … )` group — it reads commands but, unlike a substitution, feeds no output.
   */
  kind:
    | 'root'
    | 'command'
    | 'arithmetic'
    | 'backtick'
    | 'parameter'
    | 'keysubscript'
    | 'arrayliteral'
    | 'subshell'
  quote: ShellQuote
  parenthesisDepth: number
  /** Open `[`/`]` depth of a bracketed frame — a `$[ ]`, an indexed subscript, or an associative key. */
  bracketDepth?: number
  literalRoot: boolean
  /** Inside `[[ ]]`, where only `&&` and `||` end a clause. */
  conditional?: boolean
  /** On a `parameter` frame opened inside double quotes, where single quotes stay literal. */
  inDoubleQuotes?: boolean
  /** On a `parameter` frame, the cursor is still at the operator right after the name. */
  atOperator?: boolean
  /** On a `parameter` frame, its substring offset/length is being read as arithmetic. */
  arithmeticTail?: boolean
  /** The integer attribute this frame's scope sets (`-i` → true) or clears (`+i` → false) per name. */
  integerAttribute?: Map<string, boolean>
  /** Names this frame's scope declared associative (`declare -A`), whose subscripts are string keys. */
  associativeArrays?: Set<string>
  /** On a `parameter` frame, the expanded name, so a `${name[…]}` subscript can check its array type. */
  parameterName?: string
  /** On an `arrayliteral` frame, the array being assigned, so its element keys check the array type. */
  arrayName?: string
  /** A substitution opened inside a non-arithmetic assignment prefix, so a keyword must not mark it. */
  prefixExcluded?: boolean
  /** Opened inside an integer assignment's value, so everything here is an arithmetic operand. */
  valueOperand?: boolean
  command?: ShellCommandScan
  /** Earlier commands of a substitution, whose output still reaches the enclosing command. */
  endedCommands?: ShellCommandScan[]
}

/**
 * The command (or `[[ ]]` clause) being scanned in a frame. A later word can make the whole
 * command arithmetic — `-eq` after its left operand, `-i` after `declare` — so the contexts
 * already recorded in it, and the commands of substitutions it closed, are kept to be marked then.
 */
interface ShellCommandScan {
  contexts: ShellOccurrenceContext[]
  nested: ShellCommandScan[]
  arithmetic: boolean
  /** The declaration builtin being read, if any — only `declare`/`typeset` give a global attribute. */
  declarationBuiltin?: 'declare' | 'typeset' | 'local'
  /** The integer attribute the last declaration option set (`-i`) or cleared (`+i`). */
  integerOption?: 'set' | 'clear'
  /** A `declare -A` was read, so the declared names are associative (string-keyed) arrays. */
  associativeOption?: boolean
  /** A `declare -a` was read, so the declared names are indexed arrays (resetting any prior type). */
  indexedOption?: boolean
  /** The command is a builtin (`unset`/`read`/…) whose name arguments carry arithmetic subscripts. */
  nameArgumentBuiltin?: boolean
  /** True once the command word (past any `name=value` assignment prefix) has been read. */
  sawCommandWord: boolean
  /** A non-arithmetic assignment prefix is being read, so a later keyword must not mark its value. */
  inPrefixValue: boolean
  /** An integer assignment's value is being read — arithmetic, but only this value, not the command. */
  valueArithmetic: boolean
  /** An integer assignment was seen; its value becomes arithmetic once the `=` is passed, not its subscript. */
  pendingValue?: boolean
  /** A redirect target (a filename) is being read, never an arithmetic operand of its command. */
  inRedirectTarget: boolean
}

interface ShellOccurrenceContext {
  quote: ShellQuote
  /** Its value reaches an arithmetic evaluation — a frame, or a command marked arithmetic later. */
  arithmetic?: boolean
  unsupported?: 'escaped sequence'
}

interface ShellSpan {
  start: number
  end: number
}

const ARITHMETIC_CONDITIONAL_OPERATOR = /^-(?:eq|ne|lt|le|gt|ge)$/
/** A declaration option word (`-i`, `+i`, `-A`, `-iA`, …); its letters set each attribute. */
const DECLARATION_OPTION = /^([-+])([A-Za-z]+)$/
/** Invocation prefixes that run the following word as the command, so they are not the command. */
const SHELL_COMMAND_PREFIXES = new Set(['command', 'builtin', 'exec', 'nohup'])
/**
 * Builtins whose every argument names a variable, so an indexed-array subscript there is arithmetic.
 * Limited to `unset`, whose arguments are all names; `read`/`mapfile` mix name and option-value
 * arguments (`read -p prompt name`), so their subscripts are left to a conservative compile.
 */
const NAME_ARGUMENT_BUILTINS = new Set(['unset'])
/** Reserved words that introduce a command rather than being one, so the next word is the command. */
const SHELL_RESERVED_WORDS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'for',
  'select',
  'case',
  'esac',
  'time',
  '!',
])
const SHELL_WORD = /[^\s;&|()<>]+/y
const PARAMETER_NAME = /[!#]?(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!-])/y
const SHELL_NAME_SOURCE = '[A-Za-z_][A-Za-z0-9_]*'
const SHELL_NAME = new RegExp(`^${SHELL_NAME_SOURCE}`)
/** A word that is exactly a bare shell name (no subscript or suffix). */
const SHELL_BARE_NAME = new RegExp(`^${SHELL_NAME_SOURCE}$`)
/** A `name=`, `name+=` or `name[subscript]=` assignment word; group 1 is the bare name. */
const SHELL_ASSIGNMENT_WORD = new RegExp(`^(${SHELL_NAME_SOURCE})(?:\\[.*\\])?\\+?=`)
/** A command word ending in an unescaped backslash — a line continuation to join with the next line. */
const TRAILING_LINE_CONTINUATION = /(?:^|[^\\])(?:\\\\)*\\$/

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

function shellWordStarts(code: string, index: number): boolean {
  const previous = code[index - 1]
  return previous === undefined || /\s|[;&|()<>]/.test(previous)
}

function shellCommentStarts(code: string, index: number): boolean {
  return code[index] === '#' && shellWordStarts(code, index)
}

function shellArithmeticCommandStarts(code: string, index: number): boolean {
  return code[index] === '(' && code[index + 1] === '(' && shellWordStarts(code, index)
}

/** `;`, `&` and `|` end a command unless they belong to a redirection such as `>&2` or `&>`. */
function shellCommandSeparator(code: string, index: number): boolean {
  const character = code[index]
  if (character === '\n') return true
  if (character !== ';' && character !== '&' && character !== '|') return false
  return !/[<>]/.test(code[index - 1] ?? '') && !(character === '&' && code[index + 1] === '>')
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
  return inner.trim() === occurrence.name && SHELL_BARE_NAME.test(occurrence.name)
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
 * Removes shell quoting from a word so a keyword, option or name is recognized as bash would after
 * quote removal — `declare "-i"` and `'let'` match. Values keep their own quoting; this only feeds
 * the command-position checks, never a placeholder's emitted expansion.
 */
function unquoteShellWord(word: string): string {
  return word.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"|\\(.)/g, (_match, single, double, escaped) =>
    single !== undefined ? single : double !== undefined ? double : escaped
  )
}

/** Frames whose text is a command line, where words are classified and separators end a command. */
function readsCommands(frame: ShellScanFrame): boolean {
  return (
    frame.kind === 'root' ||
    frame.kind === 'command' ||
    frame.kind === 'backtick' ||
    frame.kind === 'subshell'
  )
}

/** A command substitution — `$( )` or backticks — whose output the enclosing command receives. */
function isSubstitution(frame: ShellScanFrame): boolean {
  return frame.kind === 'command' || frame.kind === 'backtick'
}

/**
 * Whether a frame puts the cursor in arithmetic — an arithmetic expansion, an integer-value operand,
 * a `${…}` substring tail, or a command marked arithmetic. `arithmeticDepth` counts these as they
 * open and close; this predicate reads the same set for a point-in-time check of the frame stack.
 */
function frameIsArithmetic(frame: ShellScanFrame): boolean {
  return (
    frame.kind === 'arithmetic' ||
    frame.valueOperand === true ||
    (frame.kind === 'parameter' && frame.arithmeticTail === true) ||
    frame.command?.arithmetic === true
  )
}

/** Where a `name=…` word is an assignment: a command prefix, or an argument to a declaration builtin. */
function inAssignmentPosition(command: ShellCommandScan): boolean {
  return !command.sawCommandWord || command.declarationBuiltin !== undefined
}

function commandScanOf(frame: ShellScanFrame): ShellCommandScan {
  frame.command ??= {
    contexts: [],
    nested: [],
    arithmetic: false,
    sawCommandWord: false,
    inPrefixValue: false,
    valueArithmetic: false,
    inRedirectTarget: false,
  }
  return frame.command
}

/**
 * A `[`/`]`-nesting frame: `arithmetic` for a `$[ ]` or an indexed-array subscript (whose index is
 * evaluated), `keysubscript` for an associative array's `[key]` (a string, scanned but not arithmetic).
 */
function subscriptFrame(kind: 'arithmetic' | 'keysubscript'): ShellScanFrame {
  return { kind, quote: 'none', parenthesisDepth: 0, bracketDepth: 1, literalRoot: false }
}

/** A `( )`-delimited command frame: a `$( )` command substitution, or a bare `( )` subshell. */
function parenCommandFrame(kind: 'command' | 'subshell'): ShellScanFrame {
  return { kind, quote: 'none', parenthesisDepth: 1, literalRoot: false }
}

/**
 * Whether the `name[...]` opening at `open` is an indexed assignment (`a[i]=`, `a[i]+=`), whose
 * subscript bash evaluates as arithmetic. Brackets nest so `a[b[0]]=` pairs correctly; the scan
 * stops at the first unbracketed word boundary, since an unquoted assignment word cannot cross it.
 */
function opensIndexedAssignment(code: string, open: number, end: number): boolean {
  let depth = 0
  for (let index = open; index < end; index += 1) {
    const character = code[index]
    if (character === '[') depth += 1
    else if (character === ']') {
      depth -= 1
      if (depth === 0) {
        const after = code[index + 1]
        return after === '=' || (after === '+' && code[index + 2] === '=')
      }
    } else if (depth === 0 && /[\s;&|()<>]/.test(character)) return false
  }
  return false
}

/**
 * Jumps over `skippedRanges` (sorted heredoc bodies, which bash reads as data) so body prose
 * cannot shift quote context; bodies that need contexts are scanned on their own with `literalRoot`.
 * Spans other than placeholders (heredoc operators) get a context too, for where their body lands.
 */
function collectShellOccurrenceContexts<T extends ShellSpan>(
  code: string,
  occurrences: readonly T[],
  start: number,
  end: number,
  literalRoot: boolean,
  skippedRanges: Array<[number, number]> = [],
  operatorStarts: ReadonlySet<number> = new Set()
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
  /**
   * How many open frames put the cursor in arithmetic: `$(( ))`/`(( ))`/`$[ ]`/subscript frames,
   * integer-value operands, `${…}` substring tails, and commands marked arithmetic. Kept as a count
   * so each placeholder reads it in O(1) rather than walking the whole frame stack.
   */
  let arithmeticDepth = 0

  const pushFrame = (frame: ShellScanFrame) => {
    const enclosing = frames.at(-1)
    if (enclosing?.command?.inPrefixValue) frame.prefixExcluded = true
    if (enclosing?.command?.valueArithmetic) frame.valueOperand = true
    frames.push(frame)
    if (frame.kind === 'arithmetic' || frame.valueOperand) arithmeticDepth += 1
  }
  /**
   * A closed substitution or `${…}` passes its recorded values to the enclosing command, so a later
   * `-eq`/`let`/`-i` still reaches a value read inside it — unless it was part of a non-arithmetic
   * assignment prefix, which a keyword must not reach.
   */
  const popFrame = () => {
    const closed = frames.pop()
    if (!closed) return
    if (closed.kind === 'arithmetic' || closed.valueOperand) arithmeticDepth -= 1
    if (closed.kind === 'parameter' && closed.arithmeticTail) arithmeticDepth -= 1
    if (closed.command?.arithmetic) arithmeticDepth -= 1
    const enclosing = frames.at(-1)
    // Only arithmetic frames have no values to pass up; every other closable frame is a command
    // substitution or a `${…}`, whose values the enclosing command may still mark.
    if (!enclosing || closed.kind === 'arithmetic' || closed.prefixExcluded) return
    const enclosingCommand = commandScanOf(enclosing)
    for (const ended of closed.endedCommands ?? []) enclosingCommand.nested.push(ended)
    if (closed.command) enclosingCommand.nested.push(closed.command)
  }
  /** Whether `name` has the integer attribute here: the nearest scope that sets or clears it wins. */
  const declaresInteger = (name: string): boolean => {
    for (let depth = frames.length - 1; depth >= 0; depth -= 1) {
      const attribute = frames[depth].integerAttribute?.get(name)
      if (attribute !== undefined) return attribute
    }
    return false
  }
  /** Whether `name` is a `declare -A` associative array, whose subscript is a string key, not arithmetic. */
  const isAssociativeArray = (name: string) =>
    frames.some((frame) => frame.associativeArrays?.has(name))
  /** A subscript frame for `name`'s array: a string key for an associative array, else an arithmetic index. */
  const subscriptFrameFor = (name: string | undefined) =>
    subscriptFrame(isAssociativeArray(name ?? '') ? 'keysubscript' : 'arithmetic')
  /** Forget a name's tracked type in every scope — on `unset`, or a re-declaration that changes it. */
  const clearNameType = (name: string) => {
    for (const frame of frames) {
      frame.associativeArrays?.delete(name)
      frame.integerAttribute?.delete(name)
    }
  }
  /** Whether a `>`/`<` redirect operator immediately precedes `at`, across any intervening blanks. */
  const precededByRedirect = (at: number): boolean => {
    let cursor = at - 1
    while (cursor >= start && (code[cursor] === ' ' || code[cursor] === '\t')) cursor -= 1
    return code[cursor] === '>' || code[cursor] === '<'
  }
  /** The array name immediately before the subscript `[` at `bracket`, if a valid identifier precedes it. */
  const arrayNameBefore = (bracket: number): { name: string; start: number } | undefined => {
    let nameStart = bracket - 1
    while (nameStart >= start && /[A-Za-z0-9_]/.test(code[nameStart])) nameStart -= 1
    nameStart += 1
    if (nameStart >= bracket || !/[A-Za-z_]/.test(code[nameStart])) return undefined
    return { name: code.slice(nameStart, bracket), start: nameStart }
  }
  /** Inside a double-quoted `${…}` single quotes are literal, so the binding keeps its double-quoting. */
  const effectiveQuote = (frame: ShellScanFrame): ShellQuote =>
    frame.kind === 'parameter' && frame.quote === 'none'
      ? frame.inDoubleQuotes
        ? 'double'
        : 'none'
      : frame.quote
  const endCommand = (frame: ShellScanFrame) => {
    if (!frame.command) return
    if (frame.command.arithmetic) arithmeticDepth -= 1
    else if (frame.kind !== 'root') (frame.endedCommands ??= []).push(frame.command)
    frame.command = undefined
  }
  /** True wherever a placeholder's value would be re-read as arithmetic at this point in the scan. */
  const inArithmetic = () => arithmeticDepth > 0
  const record = (occurrence: T, occurrenceContext: ShellOccurrenceContext) => {
    contexts.set(occurrence, occurrenceContext)
    const innermost = frames.at(-1)
    // A non-arithmetic assignment prefix's value, and a redirect target, are left out so a later
    // keyword cannot mark them arithmetic.
    if (innermost && !innermost.command?.inPrefixValue && !innermost.command?.inRedirectTarget)
      commandScanOf(innermost).contexts.push(occurrenceContext)
  }
  /** Marks the frame's command, and every context already recorded in it, as arithmetic. */
  const markCommandArithmetic = (frame: ShellScanFrame) => {
    const command = commandScanOf(frame)
    if (command.arithmetic) return
    command.arithmetic = true
    arithmeticDepth += 1
    const pending = [command]
    for (let scan = pending.pop(); scan; scan = pending.pop()) {
      for (const commandContext of scan.contexts) commandContext.arithmetic = true
      for (const nested of scan.nested) pending.push(nested)
      scan.contexts = []
      scan.nested = []
    }
  }
  /**
   * Reads one word at a command boundary and applies the syntax that depends on command position.
   * `let`, `[[` and the declaration builtins are keywords only as the command name — past any
   * `name=value` prefix, invocation prefix (`command`/`builtin`) or reserved word, and never a
   * redirect target — so an argument of the same spelling (`echo let …`) is left alone. The `[[`
   * operators and the declaration `-i` option are read wherever they appear; an assignment to an
   * integer-declared name counts only in assignment position.
   */
  const scanWord = (frame: ShellScanFrame, index: number) => {
    SHELL_WORD.lastIndex = index
    const raw = SHELL_WORD.exec(code)?.[0]
    if (raw === undefined) return
    // Join line continuations so a split command name is still recognized (`le\<newline>t` → `let`).
    // `SHELL_WORD` stops at the newline, so each continued segment is read and appended here.
    let joined = raw
    let after = index + raw.length
    while (
      TRAILING_LINE_CONTINUATION.test(joined) &&
      (code[after] === '\n' || code[after] === '\r')
    ) {
      joined = joined.slice(0, -1)
      after += code[after] === '\r' && code[after + 1] === '\n' ? 2 : 1
      SHELL_WORD.lastIndex = after
      const next = SHELL_WORD.exec(code)
      if (!next || next.index !== after) break
      joined += next[0]
      after += next[0].length
    }
    const word = unquoteShellWord(joined)
    const command = commandScanOf(frame)
    command.valueArithmetic = false
    command.pendingValue = false
    command.inPrefixValue = false
    command.inRedirectTarget = false
    // `]]` and the `[[` comparison operators are syntax only unquoted; a quoted `"]]"` or `"-eq"` is
    // a string operand, so these read the raw word, not the quote-stripped one.
    if (raw === ']]') {
      frame.conditional = false
      return
    }
    if (frame.conditional) {
      if (ARITHMETIC_CONDITIONAL_OPERATOR.test(raw)) markCommandArithmetic(frame)
      return
    }
    // A redirect target (possibly after whitespace, `> file`) or leading file descriptor is not the
    // command word, and is a filename — never an arithmetic operand even when the command does
    // arithmetic (`let x=1 >file`), so its placeholders are flagged out of the command's marking.
    if (precededByRedirect(index)) {
      command.inRedirectTarget = true
      return
    }
    if (
      /^\d+$/.test(word) &&
      (code[index + raw.length] === '>' || code[index + raw.length] === '<')
    )
      return
    // Declaration options, read together so a combined `-iA` sets both: the integer attribute (`-i`
    // sets, `+i` clears — last wins, and `-i` is not marked until a value appears so `+i` can still
    // undo it) and `-A` (an associative array, whose subscripts are string keys, not arithmetic).
    if (command.declarationBuiltin) {
      const option = DECLARATION_OPTION.exec(word)
      if (option) {
        if (option[2].includes('i')) command.integerOption = option[1] === '-' ? 'set' : 'clear'
        if (option[1] === '-' && option[2].includes('A')) command.associativeOption = true
        if (option[1] === '-' && option[2].includes('a')) command.indexedOption = true
        return
      }
    }
    // A declaration argument names an integer (`-i`), clears one (`+i`), and/or names an associative
    // array (`-A`); the name lives in this frame's scope and pops with it. `local` is function-scoped
    // and this scanner has no function frame to drop it with, so its attributes are not tracked across
    // statements — same-command arithmetic still marks, and an untracked array stays indexed (a
    // conservative reject) rather than leaking out as text.
    if (
      command.declarationBuiltin &&
      command.declarationBuiltin !== 'local' &&
      word[0] !== '-' &&
      word[0] !== '+'
    ) {
      const declared = SHELL_NAME.exec(word)?.[0]
      if (declared) {
        // A re-declaration resets the name's type before this one's attributes apply, so a later
        // `declare -a` (indexed) clears an earlier `-A` (associative) and vice versa.
        if (command.associativeOption || command.indexedOption) clearNameType(declared)
        if (command.associativeOption) (frame.associativeArrays ??= new Set()).add(declared)
        if (command.integerOption) {
          ;(frame.integerAttribute ??= new Map()).set(declared, command.integerOption === 'set')
        }
      }
    }
    // `unset name` removes the variable and its attributes, so a later indexed reuse is arithmetic
    // again. A bare name only — `unset name[i]` removes one element, not the array's type.
    if (command.nameArgumentBuiltin && command.sawCommandWord && SHELL_BARE_NAME.test(word)) {
      clearNameType(word)
    }
    // An assignment is one only in command-prefix or declaration-argument position; `echo n=1` or
    // `printf a[i]=1` passes an ordinary string that bash never evaluates.
    const assignment = inAssignmentPosition(command) ? SHELL_ASSIGNMENT_WORD.exec(word) : null
    if (assignment) {
      // A `declare -i` argument, or any assignment to an already-integer name not cleared here, has
      // an arithmetic value. A declaration marks the whole command (every arg shares the attribute);
      // a plain prefix marks only this value, so `n=1 printf "{{x}}"` leaves the printed arg as text.
      const integerTarget =
        (command.declarationBuiltin !== undefined && command.integerOption === 'set') ||
        (command.integerOption !== 'clear' && declaresInteger(assignment[1]))
      if (integerTarget && command.declarationBuiltin) markCommandArithmetic(frame)
      else if (integerTarget) command.pendingValue = true
      else if (!command.sawCommandWord) command.inPrefixValue = true
      return
    }
    if (command.sawCommandWord) return
    if (SHELL_RESERVED_WORDS.has(word) || SHELL_COMMAND_PREFIXES.has(word)) return
    command.sawCommandWord = true
    if (word === '[[') frame.conditional = true
    else if (word === 'let') markCommandArithmetic(frame)
    else if (word === 'declare' || word === 'typeset' || word === 'local') {
      command.declarationBuiltin = word
    } else if (NAME_ARGUMENT_BUILTINS.has(word)) command.nameArgumentBuiltin = true
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

    const occurrence = occurrenceByStart.get(index)
    if (occurrence && operatorStarts.has(occurrence.start)) {
      // A heredoc operator: its body is an arithmetic operand when the substitution reading it is in
      // an arithmetic context — an enclosing `$(( ))`, or an enclosing command/value that evaluates
      // the substitution's output (`let x="$(cat <<EOF)"`). It is NOT an operand merely because the
      // heredoc's own command does arithmetic on its words (`$(let x=1 <<EOF)` feeds `let` stdin), so
      // only what encloses the innermost substitution counts, which a later `-eq` can still mark.
      let sub = frames.length - 1
      while (sub >= 0 && !isSubstitution(frames[sub])) sub -= 1
      const enclosingArithmetic = frames
        .slice(0, sub)
        .some((enclosing) => frameIsArithmetic(enclosing) || enclosing.command?.valueArithmetic)
      const operatorContext: ShellOccurrenceContext = {
        quote: 'none',
        arithmetic: enclosingArithmetic,
      }
      contexts.set(occurrence, operatorContext)
      if (sub >= 0) commandScanOf(frames[sub - 1]).contexts.push(operatorContext)
      index = occurrence.end
      continue
    }
    if (occurrence) {
      // A placeholder that is itself the redirect target (`> {{x}}`) is a filename, never arithmetic;
      // `scanWord` never ran on it (the occurrence is consumed first), so the immediately preceding
      // `>`/`<` — across any whitespace — is checked here, but only in a command frame: inside `$(( ))`
      // a `<`/`>` is a comparison operator, not a redirect.
      const redirectTarget =
        frame.command?.inRedirectTarget === true ||
        (readsCommands(frame) && precededByRedirect(index))
      const arithmetic =
        !redirectTarget && (inArithmetic() || frame.command?.valueArithmetic === true)
      record(occurrence, { quote: effectiveQuote(frame), arithmetic })
      index = occurrence.end
      continue
    }

    const character = code[index]
    // The redirect-target flag covers only its one word; unquoted whitespace ends that word, so a
    // following argument (`let x=1 >/dev/null {{x}}`) is marked by the command again.
    if (frame.command?.inRedirectTarget && frame.quote === 'none' && /\s/.test(character)) {
      frame.command.inRedirectTarget = false
    }
    // Classify each command word before the quote branches consume a quote-initial word such as
    // `"-i"` or `'let'`. `scanWord` only sets state, never advances `index`; the characters below
    // still process the word's text.
    if (
      readsCommands(frame) &&
      !frame.literalRoot &&
      frame.quote === 'none' &&
      shellWordStarts(code, index) &&
      !shellCommentStarts(code, index) &&
      !shellCommandSeparator(code, index)
    ) {
      scanWord(frame, index)
    }
    // An integer assignment's value turns arithmetic at its `=` — not its subscript, so an index
    // placeholder in `m[{{x}}]=1` is judged by the array type, not by the value's attribute.
    if (character === '=' && frame.command?.pendingValue) {
      frame.command.valueArithmetic = true
      frame.command.pendingValue = false
    }
    // A name-taking builtin's argument subscript (`unset a[i]`, `unset "a[i]"`, `unset 'a[i]'`) is
    // arithmetic — even single-quoted, since the subscript is still evaluated. This runs before the
    // quote branches, which would otherwise consume the `[` of a quoted argument.
    if (
      character === '[' &&
      !frame.literalRoot &&
      readsCommands(frame) &&
      frame.command?.nameArgumentBuiltin &&
      frame.command.sawCommandWord
    ) {
      const named = arrayNameBefore(index)
      if (
        named &&
        /[\s;&|()<>"']/.test(code[named.start - 1] ?? ' ') &&
        !isAssociativeArray(named.name)
      ) {
        pushFrame(subscriptFrame('arithmetic'))
        index += 1
        continue
      }
    }
    // A `${…}` expansion, including one nested in another's value or an associative key. Only an
    // `arithmetic` frame reads a nested `${b}` as operand text rather than its own expansion, so the
    // gate excludes it; a `keysubscript` (string key) does take nested expansions.
    if (
      character === '$' &&
      code[index + 1] === '{' &&
      frame.kind !== 'arithmetic' &&
      (frame.quote === 'none' || frame.quote === 'double')
    ) {
      PARAMETER_NAME.lastIndex = index + 2
      const name = PARAMETER_NAME.exec(code)
      if (name) {
        pushFrame({
          kind: 'parameter',
          quote: 'none',
          inDoubleQuotes: effectiveQuote(frame) === 'double',
          parenthesisDepth: 0,
          atOperator: true,
          parameterName: name[0].replace(/^[!#]/, ''),
          literalRoot: false,
        })
        index += 2 + name[0].length
        continue
      }
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
          record(escaped, { quote: frame.quote, unsupported: 'escaped sequence' })
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
      frame.quote === 'none' && !frame.literalRoot && shellArithmeticCommandStarts(code, index)
    if (arithmeticExpansion || arithmeticCommand) {
      const brackets = arithmeticExpansion && code[index + 1] === '['
      pushFrame(
        brackets
          ? subscriptFrame('arithmetic')
          : { kind: 'arithmetic', quote: 'none', parenthesisDepth: 2, literalRoot: false }
      )
      index += arithmeticExpansion && !brackets ? 3 : 2
      continue
    }
    if (frame.quote === 'double') {
      if (character === '\\') {
        const escaped = occurrenceByStart.get(index + 1)
        if (escaped) {
          record(escaped, { quote: frame.quote, unsupported: 'escaped sequence' })
          index = escaped.end
        } else {
          index += 2
        }
      } else if (character === '"') {
        frame.quote = 'none'
        index += 1
      } else if (character === '$' && code[index + 1] === '(') {
        pushFrame(parenCommandFrame('command'))
        index += 2
      } else if (character === '`') {
        pushFrame({ kind: 'backtick', quote: 'none', parenthesisDepth: 0, literalRoot: false })
        index += 1
      } else {
        index += 1
      }
      continue
    }

    if (frame.kind === 'backtick' && character === '`') {
      popFrame()
      index += 1
      continue
    }
    // `#` starts a comment only where commands are read; inside a `${…}` or a subscript it is literal.
    if (readsCommands(frame) && !frame.literalRoot && shellCommentStarts(code, index)) {
      if (!frame.conditional) endCommand(frame)
      const newline = code.indexOf('\n', index)
      index = newline === -1 || newline >= end ? end : newline + 1
      continue
    }
    if (character === '\\') {
      const escaped = occurrenceByStart.get(index + 1)
      if (escaped) {
        record(escaped, { quote: frame.quote, unsupported: 'escaped sequence' })
        index = escaped.end
      } else {
        index += 2
      }
      continue
    }
    // Inside a double-quoted `${…}`, single quotes are literal text, not a quote boundary.
    const singleQuotesLiteral = frame.kind === 'parameter' && frame.inDoubleQuotes === true
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
      pushFrame(parenCommandFrame('command'))
      index += 2
      continue
    }
    if (character === '`') {
      pushFrame({ kind: 'backtick', quote: 'none', parenthesisDepth: 0, literalRoot: false })
      index += 1
      continue
    }
    // A `${…}` expansion's arithmetic operands appear only at the operator right after the name: a
    // `[` subscript, or a `:` substring offset/length. Any other operator (`:-`, `#`, `/`, …) means
    // the rest is pattern or default text, where a later `[` or `:` is literal.
    if (frame.kind === 'parameter') {
      if (frame.atOperator) {
        // A subscript: an indexed array's is arithmetic, an associative array's is a string key.
        // Either way it opens a bracket frame so a `:offset` after the `]` is still seen as a tail.
        if (character === '[') {
          pushFrame(subscriptFrameFor(frame.parameterName))
          index += 1
          continue
        }
        if (character === ':' && !/[-=?+]/.test(code[index + 1] ?? '')) {
          frame.arithmeticTail = true
          arithmeticDepth += 1
          frame.atOperator = false
          index += 1
          continue
        }
        frame.atOperator = false
      }
      // A nested `${…}` opens its own frame above; here a bare `{` is literal text, and the first
      // unmatched `}` ends the expansion — so only `}` closes it, never a counted `{`.
      if (character === '}') {
        popFrame()
        index += 1
        continue
      }
    }
    // A compound array assignment `name=( … )`: each element key `[k]=` is a subscript of `name`.
    if (frame.kind === 'arrayliteral') {
      if (character === '(') {
        frame.parenthesisDepth += 1
        index += 1
        continue
      }
      if (character === ')') {
        frame.parenthesisDepth -= 1
        if (frame.parenthesisDepth === 0) popFrame()
        index += 1
        continue
      }
      // A key assignment `[k]=` / `[k]+=`; a bare `[x]` element (no `=`) is ordinary text.
      if (
        character === '[' &&
        /[\s(]/.test(code[index - 1] ?? ' ') &&
        opensIndexedAssignment(code, index, end)
      ) {
        pushFrame(subscriptFrameFor(frame.arrayName))
        index += 1
        continue
      }
    }
    // The `(` opening a compound array assignment (`name=(`, `name+=(`) in command-prefix or
    // declaration position. Its element keys are then judged against the array's type.
    if (
      character === '(' &&
      code[index - 1] === '=' &&
      frame.quote === 'none' &&
      !frame.literalRoot &&
      readsCommands(frame) &&
      inAssignmentPosition(commandScanOf(frame))
    ) {
      let nameEnd = index - 1
      if (code[nameEnd - 1] === '+') nameEnd -= 1
      const named = arrayNameBefore(nameEnd)
      if (named && shellWordStarts(code, named.start)) {
        pushFrame({
          kind: 'arrayliteral',
          quote: 'none',
          parenthesisDepth: 1,
          arrayName: named.name,
          literalRoot: false,
        })
        index += 1
        continue
      }
    }
    // An indexed-assignment subscript (`a[i]=`, `a[i]+=`) is evaluated as arithmetic — but only in
    // command-prefix or declaration-argument position; `printf a[i]=1` passes an ordinary string, and
    // an associative key (`declare -A m; m[k]=`) is text.
    if (
      character === '[' &&
      frame.quote === 'none' &&
      !frame.literalRoot &&
      readsCommands(frame) &&
      inAssignmentPosition(commandScanOf(frame))
    ) {
      const named = arrayNameBefore(index)
      if (
        named &&
        shellWordStarts(code, named.start) &&
        !isAssociativeArray(named.name) &&
        opensIndexedAssignment(code, index, end)
      ) {
        pushFrame(subscriptFrame('arithmetic'))
        index += 1
        continue
      }
    }
    if (readsCommands(frame)) {
      if (!frame.literalRoot) {
        const groupBrace = (character === '{' || character === '}') && shellWordStarts(code, index)
        if (shellCommandSeparator(code, index) || groupBrace) {
          const clauseEnds =
            !frame.conditional ||
            ((character === '&' || character === '|') && code[index + 1] === character)
          if (clauseEnds) endCommand(frame)
        }
      }
    }
    // A bare subshell `( … )` at a command position: scope its declarations to a frame so a
    // `(declare -A m)` inside does not leak the array type to the enclosing shell.
    if (
      character === '(' &&
      readsCommands(frame) &&
      !frame.conditional &&
      frame.quote === 'none' &&
      !frame.literalRoot &&
      shellWordStarts(code, index)
    ) {
      pushFrame(parenCommandFrame('subshell'))
      index += 1
      continue
    }
    if (
      (frame.kind === 'arithmetic' || frame.kind === 'keysubscript') &&
      frame.bracketDepth !== undefined
    ) {
      if (character === '[') frame.bracketDepth += 1
      else if (character === ']') {
        frame.bracketDepth -= 1
        if (frame.bracketDepth === 0) popFrame()
      }
      index += 1
      continue
    }
    if (
      (frame.kind === 'command' || frame.kind === 'arithmetic' || frame.kind === 'subshell') &&
      character === '('
    ) {
      frame.parenthesisDepth += 1
      index += 1
      continue
    }
    if (
      (frame.kind === 'command' || frame.kind === 'arithmetic' || frame.kind === 'subshell') &&
      character === ')'
    ) {
      frame.parenthesisDepth -= 1
      if (frame.parenthesisDepth === 0) popFrame()
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
    heredocBodyRanges(heredocs),
    new Set(heredocOperators.map((operator) => operator.start))
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
    // The operator's context already carries this: `arithmetic` is set only for a heredoc whose
    // reading substitution is itself an arithmetic operand (see where operator spans are recorded),
    // so a quoted or unquoted body there is rejected, while plain stdin falls to the body scan.
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

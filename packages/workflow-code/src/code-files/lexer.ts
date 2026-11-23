/**
 * Where an offset in stored JavaScript function code sits: in code, or inside a string, template,
 * regex or comment. A port of the executor's `getCodeStringQuoteContext`
 * (apps/sim/executor/variables/resolver.ts), restricted to JavaScript, so the code-file rewrite
 * agrees with the runtime about which `<ref>` tokens are code-position: those the runtime turns
 * into `globalThis[...]` reads (resolver.ts `formatContextVariableReference`).
 *
 * One difference is deliberate: the runtime reports comments as code-position, since a value
 * spliced into a comment is inert there. The rewrite must leave comment text verbatim,
 * so comments are reported as their own context.
 */

type JsContext = 'code' | 'single' | 'double' | 'template' | 'regex' | 'comment'

type ScanMode =
  | { type: 'normal' }
  | { type: 'single' }
  | { type: 'double' }
  | { type: 'template' }
  | { type: 'template-expression'; depth: number }
  | { type: 'line-comment' }
  | { type: 'block-comment' }
  | { type: 'regex'; inCharacterClass: boolean }

/** Characters after which a `/` opens a regular expression rather than dividing. */
const REGEX_ALLOWED_AFTER = new Set('(,=:[!&|?{};+-*%^~<>/'.split(''))

/** Keywords whose parenthesized head is followed by a statement, where a regex may start. */
const CONTROL_FLOW_HEAD_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'with'])

/** Keywords a regex may directly follow. */
const REGEX_ALLOWED_AFTER_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'case',
  'throw',
  'do',
  'else',
  'yield',
  'await',
])

const WHITESPACE_CHAR = /\s/
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_CHAR.test(char)
}

function wordEndingAt(text: string, end: number): string {
  let start = end
  while (start > 0 && isIdentifierChar(text[start - 1])) start--
  return text.slice(start, end + 1)
}

/**
 * A forward-only scanner over one code body. `contextAt` must be called with non-decreasing
 * offsets; each call resumes where the previous one stopped, so a pass over all tokens is linear.
 */
interface JsContextScanner {
  contextAt(index: number): JsContext
}

/** A {@link JsContextScanner} over `text`, starting at offset 0. */
export function createJsContextScanner(text: string): JsContextScanner {
  const modes: ScanMode[] = [{ type: 'normal' }]
  const openParenIsControlHead: boolean[] = []
  const controlHeadParenCloses = new Set<number>()
  const regexCloseIndices = new Set<number>()
  let lastSignificantIndex = -1
  let identifierFollowsPropertyAccess = false
  let position = 0

  const canStartRegex = (previousSignificantIndex: number): boolean => {
    if (previousSignificantIndex < 0) return true
    const previous = text[previousSignificantIndex]
    if (previous === ')') return controlHeadParenCloses.has(previousSignificantIndex)
    if (previous === '/' && regexCloseIndices.has(previousSignificantIndex)) return false
    if ((previous === '+' || previous === '-') && text[previousSignificantIndex - 1] === previous) {
      return false
    }
    if (REGEX_ALLOWED_AFTER.has(previous)) return true
    if (!isIdentifierChar(previous)) return false
    return REGEX_ALLOWED_AFTER_KEYWORDS.has(wordEndingAt(text, previousSignificantIndex))
  }

  const opensControlFlowHead = (previousSignificantIndex: number): boolean => {
    if (identifierFollowsPropertyAccess || previousSignificantIndex < 0) return false
    if (!isIdentifierChar(text[previousSignificantIndex])) return false
    return CONTROL_FLOW_HEAD_KEYWORDS.has(wordEndingAt(text, previousSignificantIndex))
  }

  /** Tracks significance, identifiers and parentheses; returns true when a regex opened. */
  const scanCodeChar = (i: number, char: string): boolean => {
    const previousSignificantIndex = lastSignificantIndex
    if (!WHITESPACE_CHAR.test(char)) lastSignificantIndex = i
    if (isIdentifierChar(char)) {
      if (i === 0 || !isIdentifierChar(text[i - 1])) {
        identifierFollowsPropertyAccess = text[previousSignificantIndex] === '.'
      }
    } else if (char === '(') {
      openParenIsControlHead.push(opensControlFlowHead(previousSignificantIndex))
    } else if (char === ')') {
      if (openParenIsControlHead.pop()) controlHeadParenCloses.add(i)
    }
    if (char === '/' && canStartRegex(previousSignificantIndex)) {
      modes.push({ type: 'regex', inCharacterClass: false })
      return true
    }
    return false
  }

  const advanceTo = (index: number): void => {
    let i = position
    for (; i < index; i++) {
      const char = text[i]
      const next = text[i + 1]
      const mode = modes[modes.length - 1]

      if (mode.type === 'line-comment') {
        if (char === '\n') modes.pop()
        continue
      }
      if (mode.type === 'block-comment') {
        if (char === '*' && next === '/') {
          modes.pop()
          i++
        }
        continue
      }
      if (mode.type === 'regex') {
        if (char === '\\') {
          i++
          continue
        }
        if (char === '\n') {
          modes.pop()
          continue
        }
        if (char === '[') {
          mode.inCharacterClass = true
          continue
        }
        if (char === ']') {
          mode.inCharacterClass = false
          continue
        }
        if (char === '/' && !mode.inCharacterClass) {
          modes.pop()
          regexCloseIndices.add(i)
          lastSignificantIndex = i
        }
        continue
      }
      if (mode.type === 'single' || mode.type === 'double') {
        const quote = mode.type === 'single' ? "'" : '"'
        if (char === '\\') {
          i++
          continue
        }
        if (char === quote || char === '\n') modes.pop()
        continue
      }
      if (mode.type === 'template') {
        if (char === '\\') {
          i++
          continue
        }
        if (char === '`') {
          modes.pop()
          continue
        }
        if (char === '$' && next === '{') {
          modes.push({ type: 'template-expression', depth: 1 })
          i++
        }
        continue
      }

      if (char === '/' && next === '/') {
        modes.push({ type: 'line-comment' })
        i++
        continue
      }
      if (char === '/' && next === '*') {
        modes.push({ type: 'block-comment' })
        i++
        continue
      }
      if (scanCodeChar(i, char)) continue
      if (char === "'") {
        modes.push({ type: 'single' })
        continue
      }
      if (char === '"') {
        modes.push({ type: 'double' })
        continue
      }
      if (char === '`') {
        modes.push({ type: 'template' })
        continue
      }
      if (mode.type === 'template-expression') {
        if (char === '{') {
          mode.depth += 1
        } else if (char === '}') {
          mode.depth -= 1
          if (mode.depth === 0) modes.pop()
        }
      }
    }
    position = i
  }

  return {
    contextAt(index: number): JsContext {
      advanceTo(index)
      const mode = modes[modes.length - 1]
      switch (mode.type) {
        case 'normal':
        case 'template-expression':
          return 'code'
        case 'line-comment':
        case 'block-comment':
          return 'comment'
        default:
          return mode.type
      }
    },
  }
}

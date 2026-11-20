import { parseUserJavaScript } from '@/lib/execution/javascript-syntax'
import { DocCompileUserError } from '@/lib/uploads/documents/compile-error'

export type DocumentSourceLanguage = 'javascript' | 'python'

interface DocumentFileReference {
  fileId: string
  start: number
  end: number
}

interface SourceToken {
  kind: 'word' | 'string' | 'punctuation'
  value: string
  start: number
}

const FILE_HELPERS = new Set(['getFileBase64', 'addImage', 'drawImage', 'input_path'])
const INPUT_PATH_PREFIX = '/home/user/inputs/'
/**
 * Every reference is a token whose raw source text is a helper name or starts with the input
 * path, so a source containing none of these substrings has no references and is never parsed.
 */
const REFERENCE_MARKERS = [...FILE_HELPERS, INPUT_PATH_PREFIX]

interface LexedToken {
  label: string
  start: number
  end: number
}

/** A token Babel lexed, as opposed to a comment, which shares its token list. */
function lexedToken(value: unknown): LexedToken | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const type: unknown = Reflect.get(value, 'type')
  const label: unknown =
    typeof type === 'object' && type !== null ? Reflect.get(type, 'label') : undefined
  const start: unknown = Reflect.get(value, 'start')
  const end: unknown = Reflect.get(value, 'end')
  if (typeof label !== 'string' || typeof start !== 'number' || typeof end !== 'number')
    return undefined
  return { label, start, end }
}

function* javascriptTokens(source: string): Generator<SourceToken> {
  let lexed: LexedToken[]
  try {
    lexed = (parseUserJavaScript(source, { tokens: true }).tokens ?? []).flatMap(
      (token: unknown) => lexedToken(token) ?? []
    )
  } catch (error) {
    if (error instanceof SyntaxError) throw new DocCompileUserError(error.message)
    throw error
  }
  for (let index = 0; index < lexed.length; index++) {
    const token = lexed[index]
    if (token.label === 'eof') continue
    if (token.label === 'string') {
      yield {
        kind: 'string',
        value: source.slice(token.start + 1, token.end - 1),
        start: token.start + 1,
      }
      continue
    }
    /*
     * A template with nothing substituted into it is one string, as a quoted literal is: its
     * backticks are not tokens of their own, so a call's `(` stays right before the string.
     */
    const chunk = lexed[index + 1]
    if (token.label === '`' && chunk?.label === 'template' && lexed[index + 2]?.label === '`') {
      yield { kind: 'string', value: source.slice(chunk.start, chunk.end), start: chunk.start }
      index += 2
      continue
    }
    yield {
      kind: token.label === 'name' ? 'word' : 'punctuation',
      value: source.slice(token.start, token.end),
      start: token.start,
    }
  }
}

function* pythonTokens(source: string): Generator<SourceToken> {
  let cursor = 0
  function* stringTokens(quote: string, formatted: boolean, depth: number): Generator<SourceToken> {
    if (depth > 100) throw new DocCompileUserError('Document source strings are nested too deeply')
    cursor += quote.length
    const contentStart = cursor
    let interpolated = false
    while (cursor < source.length && !source.startsWith(quote, cursor)) {
      const start = cursor
      const char = source[cursor++]
      if (formatted && (char === '{' || char === '}') && source[cursor] === char) {
        cursor++
      } else if (formatted && char === '{') {
        interpolated = true
        yield { kind: 'punctuation', value: '{', start }
        yield* codeTokens(true, depth + 1)
      } else if (char === '\\' && !(formatted && /[{}]/.test(source[cursor] ?? ''))) {
        cursor++
      }
    }
    if (cursor >= source.length) throw new DocCompileUserError('Unterminated Python string')
    if (!interpolated) {
      yield { kind: 'string', value: source.slice(contentStart, cursor), start: contentStart }
    }
    cursor += quote.length
    if (interpolated) yield { kind: 'punctuation', value: quote, start: cursor - quote.length }
  }

  function* formatTokens(depth: number): Generator<SourceToken> {
    while (cursor < source.length) {
      const start = cursor
      const char = source[cursor++]
      if (char === '}') {
        yield { kind: 'punctuation', value: char, start }
        return
      }
      if (char === '{') {
        yield { kind: 'punctuation', value: char, start }
        yield* codeTokens(true, depth + 1)
      }
    }
    throw new DocCompileUserError('Unterminated Python format specification')
  }

  function* codeTokens(replacement: boolean, depth: number): Generator<SourceToken> {
    if (depth > 100)
      throw new DocCompileUserError('Document source expressions are nested too deeply')
    let brackets = 0
    while (cursor < source.length) {
      const start = cursor
      const char = source[cursor++]
      if (/\s/.test(char)) continue
      if (char === '#') {
        while (cursor < source.length && source[cursor] !== '\n') cursor++
        continue
      }
      if (char === '"' || char === "'") {
        const quote = source.slice(start, start + 3) === char.repeat(3) ? char.repeat(3) : char
        cursor = start
        yield* stringTokens(quote, false, depth)
        continue
      }
      if (/[A-Za-z_]/.test(char)) {
        while (cursor < source.length && /\w/.test(source[cursor])) cursor++
        const word = source.slice(start, cursor)
        const next = source[cursor]
        if (/^(?:r|u|b|f|br|rb|fr|rf)$/i.test(word) && (next === '"' || next === "'")) {
          const quote = source.slice(cursor, cursor + 3) === next.repeat(3) ? next.repeat(3) : next
          yield* stringTokens(quote, /f/i.test(word), depth)
        } else {
          yield { kind: 'word', value: word, start }
        }
        continue
      }
      yield { kind: 'punctuation', value: char, start }
      if (replacement && brackets === 0) {
        if (char === '}') return
        if (char === ':') {
          yield* formatTokens(depth)
          return
        }
      }
      if ('([{'.includes(char)) brackets++
      else if (')]}'.includes(char)) brackets--
    }
    if (replacement) throw new DocCompileUserError('Unterminated Python replacement expression')
  }
  yield* codeTokens(false, 0)
}

/** Shares static helper and input-path references between document compilation and copying. */
export function* iterateDocumentFileReferences(
  source: string,
  language: DocumentSourceLanguage
): Generator<DocumentFileReference> {
  if (!REFERENCE_MARKERS.some((marker) => source.includes(marker))) return
  const previous: SourceToken[] = []
  for (const token of language === 'javascript' ? javascriptTokens(source) : pythonTokens(source)) {
    if (token.kind === 'string') {
      const path = /^\/home\/user\/inputs\/([A-Za-z0-9_-]+)$/.exec(token.value)
      const helper =
        previous.at(-1)?.value === '('
          ? previous.at(-2)
          : previous.at(-1)?.value === ',' &&
              previous.at(-2)?.kind === 'word' &&
              previous.at(-3)?.value === '('
            ? previous.at(-4)
            : undefined
      const fileId =
        path?.[1] ??
        (helper?.kind === 'word' &&
        FILE_HELPERS.has(helper.value) &&
        /^[A-Za-z0-9_-]+$/.test(token.value)
          ? token.value
          : undefined)
      if (fileId) {
        const start = token.start + (path ? INPUT_PATH_PREFIX.length : 0)
        yield { fileId, start, end: start + fileId.length }
      }
    }
    previous.push(token)
    if (previous.length > 4) previous.shift()
  }
}

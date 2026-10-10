import { tokenizer } from 'acorn'
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

function* javascriptTokens(source: string): Generator<SourceToken> {
  try {
    const tokens = tokenizer(source, { ecmaVersion: 'latest', allowHashBang: true })
    for (let token = tokens.getToken(); token.type.label !== 'eof'; token = tokens.getToken()) {
      const label = token.type.label
      if (label === 'string') {
        yield {
          kind: 'string',
          value: source.slice(token.start + 1, token.end - 1),
          start: token.start + 1,
        }
      } else if (label === 'template') {
        if (source[token.start - 1] === '`' && source[token.end] === '`') {
          yield { kind: 'string', value: source.slice(token.start, token.end), start: token.start }
        }
      } else {
        yield {
          kind: label === 'name' ? 'word' : 'punctuation',
          value: source.slice(token.start, token.end),
          start: token.start,
        }
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) throw new DocCompileUserError(error.message)
    throw error
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
        const start = token.start + (path ? '/home/user/inputs/'.length : 0)
        yield { fileId, start, end: start + fileId.length }
      }
    }
    previous.push(token)
    if (previous.length > 4) previous.shift()
  }
}

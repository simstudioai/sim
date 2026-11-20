import { type ParseResult, parse } from '@babel/parser'
import type { File } from '@babel/types'

interface UserJavaScriptParseOptions {
  /** Include every token, comments among them, on `tokens`. */
  tokens?: boolean
}

/**
 * Parses JavaScript a user wrote, which runs as the body of an async function: top-level
 * `return` and `await` are allowed, static imports may sit anywhere, and the source is
 * sloppy-mode script, as the sandboxes evaluate it. Throws a `SyntaxError` carrying `loc` at
 * the first error, recoverable or not: code that does not parse is never half-read.
 */
export function parseUserJavaScript(
  code: string,
  { tokens = false }: UserJavaScriptParseOptions = {}
): ParseResult<File> {
  return parse(code, {
    sourceType: 'script',
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    tokens,
    plugins: ['jsx'],
  })
}

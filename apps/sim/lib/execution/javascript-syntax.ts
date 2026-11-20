import { type ParseResult, parse } from '@babel/parser'
import type { File } from '@babel/types'

interface UserJavaScriptParseOptions {
  /** Keep parsing past errors that leave the tree intact, listing them on `errors`. */
  errorRecovery?: boolean
  /** Include every token, comments among them, on `tokens`. */
  tokens?: boolean
}

/**
 * Parses JavaScript a user wrote, which runs as the body of an async function: top-level
 * `return` and `await` are allowed, static imports may sit anywhere, and the source is
 * sloppy-mode script, as the sandboxes evaluate it. Throws a `SyntaxError` carrying `loc`
 * when the source does not parse.
 */
export function parseUserJavaScript(
  code: string,
  { errorRecovery = false, tokens = false }: UserJavaScriptParseOptions = {}
): ParseResult<File> {
  return parse(code, {
    sourceType: 'script',
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery,
    tokens,
    plugins: ['jsx'],
  })
}

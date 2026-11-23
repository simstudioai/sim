import { isLikelyWorkflowReferenceSegment } from '@sim/utils/workflow-references'
import { CODE_FILE_EXTENSIONS } from '../limits'
import { createJsContextScanner } from './lexer'
import { ENV_VAR_NAME, formatMemberPath, parseStoredPath } from './ref-path'

/** The languages a function block runs (`CodeLanguage`, apps/sim/lib/execution/languages.ts). */
export type CodeFileLanguage = keyof typeof CODE_FILE_EXTENSIONS

export const REF_ROOT = '$ref'
export const ENV_ROOT = '$env'

/** Candidate tokens: `<path>` on one line, or `{{NAME}}`. */
const TOKEN = /<([^<>\s]+)>|\{\{([^{}\s]+)\}\}/g

/** The language a code file's extension names, or `null` for any other extension. */
export function codeFileLanguage(path: string): CodeFileLanguage | null {
  for (const [language, extension] of Object.entries(CODE_FILE_EXTENSIONS)) {
    if (path.endsWith(`.${extension}`)) return language as CodeFileLanguage
  }
  return null
}

/**
 * Turns stored function code into the text of its code file.
 *
 * JavaScript: a code-position `<a.b>` becomes `$ref.a.b` and `{{X}}` becomes `$env.X`, so the
 * file is valid JS that editors and the type-checker can read. Tokens inside strings,
 * templates, regexes and comments stay verbatim: the runtime splices those as text, and
 * rewriting them would change what the string says. Tokens outside the path grammar stay
 * verbatim too; the printer's bijection check then decides whether the file form is usable.
 *
 * Python and shell bodies are returned unchanged. The runtime rewrites their tokens with its own
 * per-language quoting (resolver.ts `formatContextVariableReference`), this package has no parser
 * for either language to rewrite them back exactly, and no type-checker reads those files, so a
 * rewrite would add risk and no checking. The file holds the stored body byte for byte.
 */
export function toCodeFile(code: string, language: CodeFileLanguage): string {
  if (language !== 'javascript') return code
  const scanner = createJsContextScanner(code)
  let result = ''
  let cursor = 0
  for (const match of code.matchAll(TOKEN)) {
    const start = match.index
    const replacement = formatToken(match[0], match[1], match[2])
    if (replacement === null || scanner.contextAt(start) !== 'code') continue
    result += code.slice(cursor, start) + replacement
    cursor = start + match[0].length
  }
  return result + code.slice(cursor)
}

function formatToken(
  token: string,
  inner: string | undefined,
  envName: string | undefined
): string | null {
  if (envName !== undefined) {
    return ENV_VAR_NAME.test(envName) ? `${ENV_ROOT}.${envName}` : null
  }
  if (inner === undefined || !isLikelyWorkflowReferenceSegment(token)) return null
  const segments = parseStoredPath(inner)
  return segments === null ? null : formatMemberPath(REF_ROOT, segments)
}

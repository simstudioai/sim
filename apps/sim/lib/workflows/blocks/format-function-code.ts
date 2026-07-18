import { getErrorMessage } from '@sim/utils/errors'
import { CodeLanguage, getLanguageDisplayName } from '@/lib/execution/languages'
import { createEnvVarPattern, replaceValidReferences } from '@/executor/utils/reference-validation'

export type FormattableCodeLanguage = CodeLanguage.JavaScript | CodeLanguage.Python

const FUNCTION_CODE_FORMAT_OPTIONS = {
  parser: 'babel',
  printWidth: 100,
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'es5',
} as const

const PYTHON_CODE_FORMAT_OPTIONS = {
  indent_style: 'space',
  indent_width: 4,
  line_ending: 'lf',
  line_width: 100,
  magic_trailing_comma: 'respect',
  quote_style: 'double',
} as const

const PYTHON_WRAPPER_NAME = '__sim_format_function__'

const JAVASCRIPT_EXPRESSION_PREFIX_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'extends',
  'new',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])
const JAVASCRIPT_EXPRESSION_OPERATOR_KEYWORDS = new Set(['in', 'instanceof', 'of'])
const PYTHON_EXPRESSION_PREFIX_KEYWORDS = new Set([
  'and',
  'as',
  'assert',
  'await',
  'case',
  'del',
  'elif',
  'else',
  'except',
  'for',
  'from',
  'if',
  'in',
  'is',
  'match',
  'not',
  'or',
  'raise',
  'return',
  'while',
  'with',
  'yield',
])
const PYTHON_EXPRESSION_OPERATOR_KEYWORDS = new Set([
  'and',
  'as',
  'else',
  'for',
  'if',
  'in',
  'is',
  'not',
  'or',
])
const EXPRESSION_END_CHARACTER = /[\p{ID_Continue}$)\]}'"`]/u
const EXPRESSION_START_CHARACTER = /[\p{ID_Start}\p{Number}_$([{'"`!+\-~/.]/u
const IDENTIFIER_AT_END = /[A-Za-z_$][\w$]*$/
const IDENTIFIER_AT_START = /^[A-Za-z_$][\w$]*/

interface ProtectedReference {
  token: string
  value: string
}

export interface FunctionCodeFormatResult {
  code: string
  changed: boolean
  error: string | null
}

export function isFormattableCodeLanguage(language: string): language is FormattableCodeLanguage {
  return language === CodeLanguage.JavaScript || language === CodeLanguage.Python
}

function looksLikeLanguageComparison(
  index: number,
  length: number,
  source: string,
  language: FormattableCodeLanguage
): boolean {
  const followsLeftAngleBracket = source[index - 1] === '<'
  const followedByRightAngleBracket = source[index + length] === '>'
  const followedByRightShiftOperator = source.startsWith('>>', index + length)
  if (followsLeftAngleBracket || (followedByRightAngleBracket && !followedByRightShiftOperator)) {
    return true
  }

  const sourceBeforeReference = source.slice(0, index).trimEnd()
  const sourceAfterReference = source.slice(index + length).trimStart()
  const previousCharacter = sourceBeforeReference.at(-1)
  const nextCharacter = sourceAfterReference.at(0)
  const previousIdentifier = sourceBeforeReference.match(IDENTIFIER_AT_END)?.[0]
  const nextIdentifier = sourceAfterReference.match(IDENTIFIER_AT_START)?.[0]
  const prefixKeywords =
    language === CodeLanguage.Python
      ? PYTHON_EXPRESSION_PREFIX_KEYWORDS
      : JAVASCRIPT_EXPRESSION_PREFIX_KEYWORDS
  const operatorKeywords =
    language === CodeLanguage.Python
      ? PYTHON_EXPRESSION_OPERATOR_KEYWORDS
      : JAVASCRIPT_EXPRESSION_OPERATOR_KEYWORDS

  const previousTokenEndsExpression =
    !!previousCharacter &&
    EXPRESSION_END_CHARACTER.test(previousCharacter) &&
    !prefixKeywords.has(previousIdentifier ?? '') &&
    !operatorKeywords.has(previousIdentifier ?? '')
  const nextTokenStartsExpression =
    !!nextCharacter &&
    EXPRESSION_START_CHARACTER.test(nextCharacter) &&
    !operatorKeywords.has(nextIdentifier ?? '')

  return previousTokenEndsExpression && nextTokenStartsExpression
}

function protectSimReferences(
  code: string,
  language: FormattableCodeLanguage
): {
  code: string
  references: ProtectedReference[]
} {
  const references: ProtectedReference[] = []

  const replaceReference = (value: string): string => {
    let tokenIndex = references.length
    let token = ''
    do {
      const tokenPrefix = `_${tokenIndex.toString(36)}`
      token = tokenPrefix.padEnd(Math.max(value.length, tokenPrefix.length), '_')
      tokenIndex += 1
    } while (code.includes(token) || references.some((reference) => reference.token === token))
    references.push({ token, value })
    return token
  }

  const withProtectedWorkflowReferences = replaceValidReferences(code, (value, index, source) =>
    looksLikeLanguageComparison(index, value.length, source, language)
      ? value
      : replaceReference(value)
  )
  const protectedCode = withProtectedWorkflowReferences.replace(
    createEnvVarPattern(),
    replaceReference
  )

  return { code: protectedCode, references }
}

function restoreSimReferences(code: string, references: ProtectedReference[]): string {
  return [...references]
    .sort((a, b) => b.token.length - a.token.length)
    .reduce(
      (restoredCode, reference) => restoredCode.replaceAll(reference.token, reference.value),
      code
    )
}

function wrapPythonFunctionBody(code: string): string {
  const indentedCode = code
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
  return `def ${PYTHON_WRAPPER_NAME}():\n${indentedCode}\n`
}

function unwrapPythonFunctionBody(code: string): string {
  const [declaration, ...bodyLines] = code.trimEnd().split('\n')
  if (declaration !== `def ${PYTHON_WRAPPER_NAME}():`) {
    throw new Error('Python formatter returned an unexpected wrapper')
  }

  return bodyLines.map((line) => (line.startsWith('    ') ? line.slice(4) : line)).join('\n')
}

async function formatJavaScript(code: string): Promise<string> {
  const { format } = await import('prettier')
  return format(code, FUNCTION_CODE_FORMAT_OPTIONS)
}

async function formatPython(code: string): Promise<string> {
  const { format } = await import('@wasm-fmt/ruff_fmt/node')
  const wrappedCode = wrapPythonFunctionBody(code)
  const formattedCode = format(wrappedCode, 'function.py', PYTHON_CODE_FORMAT_OPTIONS)
  return unwrapPythonFunctionBody(formattedCode)
}

/**
 * Formats a JavaScript or Python Function block body while preserving Sim's reference syntax.
 * Parse failures are returned with the original code so callers can choose how to surface them.
 */
export async function formatFunctionCode(
  code: string,
  language: FormattableCodeLanguage
): Promise<FunctionCodeFormatResult> {
  if (!code.trim()) return { code, changed: false, error: null }

  const protectedSource = protectSimReferences(code, language)

  try {
    const formattedCode =
      language === CodeLanguage.JavaScript
        ? await formatJavaScript(protectedSource.code)
        : await formatPython(protectedSource.code)
    const restoredCode = restoreSimReferences(formattedCode.trimEnd(), protectedSource.references)

    return {
      code: restoredCode,
      changed: restoredCode !== code,
      error: null,
    }
  } catch (error) {
    return {
      code,
      changed: false,
      error: getErrorMessage(error, `Unable to format ${getLanguageDisplayName(language)}`),
    }
  }
}

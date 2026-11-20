import { parse } from '@babel/parser'
import { transform } from 'sucrase'

interface TypeScriptSyntaxError {
  /** 1-based, in the source as given. */
  line: number
  message: string
}

type StripTypesResult = { code: string } | { errors: TypeScriptSyntaxError[] }

interface LocatedError {
  message: string
  loc: { line: number }
}

function isLocatedError(value: unknown): value is LocatedError {
  if (!(value instanceof Error)) return false
  const loc: unknown = Reflect.get(value, 'loc')
  return typeof loc === 'object' && loc !== null && typeof Reflect.get(loc, 'line') === 'number'
}

function toSyntaxError(error: LocatedError): TypeScriptSyntaxError {
  return { line: error.loc.line, message: error.message.replace(/ \(\d+:\d+\)$/, '') }
}

/**
 * TypeScript as JavaScript a sandbox can run: types are removed and nothing else is
 * transformed, so every line keeps its number. The source is checked first, so a program
 * that does not parse comes back as its errors and their lines instead of failing later at
 * run time with positions that no longer match what was written.
 */
export function stripTypes(source: string): StripTypesResult {
  let errors: TypeScriptSyntaxError[]
  try {
    const ast = parse(source, {
      sourceType: 'module',
      errorRecovery: true,
      plugins: ['typescript'],
    })
    errors = (ast.errors ?? []).filter(isLocatedError).map(toSyntaxError)
  } catch (error) {
    if (!isLocatedError(error)) throw error
    errors = [toSyntaxError(error)]
  }
  if (errors.length > 0) return { errors }
  return { code: transform(source, { transforms: ['typescript'], disableESTransforms: true }).code }
}

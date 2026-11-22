/**
 * Prints a declaration file the reader reads back to the same value: the header, one import, and
 * `export default defineX({ … })`, with helper calls (`{ $call, args }`) printed as calls. The
 * layout is fixed (two-space indent, trailing commas, objects on their own lines unless they are
 * short and flat), so printing the same value twice gives the same bytes.
 */
import { compareStrings } from '@sim/utils/string'
import { type Json, printKey, printNumber, quoteString } from '@sim/workflow-code'
import {
  CALL_KEY,
  DECLARATION_SDK_MAJOR,
  ENV_KEY,
  isDeclarationCall,
  isDeclarationEnvRef,
  WORKSPACE_SDK_MODULE,
} from './read'

/** Lines no longer than this print a short, flat object or array on one line. */
const INLINE_WIDTH = 80

/** A helper call node for {@link printDeclaration}: `call('column.string', { required: true })`. */
export function call(name: string, ...args: Json[]): Json {
  return { [CALL_KEY]: name, args }
}

/** An `env.NAME` node for {@link printDeclaration}. */
export function envRef(name: string): Json {
  return { [ENV_KEY]: name }
}

function isScalar(value: Json): value is string | number | boolean | null {
  return value === null || typeof value !== 'object'
}

function printInline(value: Json): string | null {
  if (isScalar(value)) return printScalar(value)
  if (isDeclarationEnvRef(value)) return `env.${value.$env}`
  if (isDeclarationCall(value)) {
    const args = value.args.map(printInline)
    return args.every((arg) => arg !== null) ? `${value.$call}(${args.join(', ')})` : null
  }
  if (Array.isArray(value)) {
    if (!value.every(isScalar)) return null
    return `[${value.map(printScalar).join(', ')}]`
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  if (
    !entries.every(
      ([, item]) =>
        isScalar(item) || isDeclarationEnvRef(item) || (Array.isArray(item) && item.every(isScalar))
    )
  ) {
    return null
  }
  return `{ ${entries.map(([key, item]) => `${printKey(key)}: ${printInline(item)}`).join(', ')} }`
}

function printScalar(value: Json): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return quoteString(value)
  if (typeof value === 'number') return printNumber(value)
  return value ? 'true' : 'false'
}

function printValue(value: Json, indent: string, column: number): string {
  const inline = printInline(value)
  if (inline !== null && column + inline.length <= INLINE_WIDTH) return inline
  if (isScalar(value)) return printScalar(value)
  if (isDeclarationEnvRef(value)) return `env.${value.$env}`
  const inner = `${indent}  `
  if (isDeclarationCall(value)) {
    const head = `${value.$call}(`
    if (value.args.length === 1) {
      return `${head}${printValue(value.args[0], indent, column + head.length)})`
    }
    return `${head}\n${value.args.map((arg) => `${inner}${printValue(arg, inner, inner.length)},\n`).join('')}${indent})`
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((item) => `${inner}${printValue(item, inner, inner.length)},\n`).join('')}${indent}]`
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  return `{\n${entries
    .map(([key, item]) => {
      const head = `${inner}${printKey(key)}: `
      return `${head}${printValue(item, inner, head.length)},\n`
    })
    .join('')}${indent}}`
}

/** Every helper root a value calls (`column` for `column.string`). */
function helperRoots(value: Json, roots: Set<string>): Set<string> {
  if (isDeclarationEnvRef(value)) {
    roots.add('env')
  } else if (isDeclarationCall(value)) {
    roots.add(value.$call.split('.')[0])
    for (const arg of value.args) helperRoots(arg, roots)
  } else if (Array.isArray(value)) {
    for (const item of value) helperRoots(item, roots)
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) helperRoots(item, roots)
  }
  return roots
}

/** Prints `value` as the argument of `export default <callee>(…)`, with the imports it needs. */
export function printDeclaration(callee: string, value: Json): string {
  const imports = [...helperRoots(value, new Set([callee]))].sort(compareStrings)
  const exported = `export default ${callee}(`
  return [
    `// @sim-sdk ${DECLARATION_SDK_MAJOR}`,
    `import { ${imports.join(', ')} } from '${WORKSPACE_SDK_MODULE}'`,
    '',
    `${exported}${printValue(value, '', exported.length)})`,
    '',
  ].join('\n')
}

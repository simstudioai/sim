/**
 * Small, deterministic text helpers for the `.d.ts` emitter: quoting, property keys, JSDoc and
 * literal unions. Output follows the repo style (2 spaces, single quotes, no semicolons).
 */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** ECMAScript reserved words plus TS contextual names that cannot name a namespace member. */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  'await',
])

export function isIdentifier(name: string): boolean {
  return IDENTIFIER.test(name)
}

/** A single-quoted string literal. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`
}

/** A property key: bare when it is an identifier, else quoted. */
export function propertyKey(name: string): string {
  return isIdentifier(name) ? name : quote(name)
}

/** A TS literal type for an option id. */
export function literal(value: string | number | boolean): string {
  return typeof value === 'string' ? quote(value) : String(value)
}

/** A union of distinct members, in first-seen order. */
export function union(members: readonly string[]): string {
  const distinct: string[] = []
  for (const member of members) if (!distinct.includes(member)) distinct.push(member)
  return distinct.length === 0 ? 'never' : distinct.join(' | ')
}

/** Parenthesises a union so it can take `[]`. */
export function arrayOf(type: string): string {
  return /^[A-Za-z0-9_.<>]+$/.test(type) ? `${type}[]` : `Array<${type}>`
}

/** `Slack send message` → `SlackSendMessage`. */
export function pascal(parts: readonly string[]): string {
  return parts
    .flatMap((part) => part.split(/[^A-Za-z0-9]+/))
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
}

function sanitizeDoc(line: string): string {
  return line.replace(/\*\//g, '*\\/').replace(/\s+/g, ' ').trim()
}

/** JSDoc lines at `indent`, or nothing when there is nothing to say. */
export function jsdoc(lines: readonly string[], indent: string): string[] {
  const clean = lines.map(sanitizeDoc).filter(Boolean)
  if (clean.length === 0) return []
  if (clean.length === 1) return [`${indent}/** ${clean[0]} */`]
  return [`${indent}/**`, ...clean.map((line) => `${indent} * ${line}`), `${indent} */`]
}

/** Indents every line of a block. */
export function indentLines(lines: readonly string[], indent: string): string[] {
  return lines.map((line) => (line === '' ? line : `${indent}${line}`))
}

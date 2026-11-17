/**
 * Characters a workflow cannot store: NUL, which Postgres `jsonb` rejects outright, and unpaired
 * UTF-16 surrogates, which have no UTF-8 encoding. Either one reaching `workflow_blocks` or
 * `workflow_source_meta` fails the write, so compile refuses them with a located diagnostic. The
 * raw text covers comments and code files; the literal pass covers escapes (`'\u0000'`,
 * `'\uD800'`) that only appear once a string is read.
 *
 * The literal pass also covers numbers JSON cannot carry as written: `1e999` reads as `Infinity`,
 * which JSON stores as `null`, and `12345678901234567890` reads as the nearest double, losing digits.
 */

import type { File, Node, NumericLiteral } from '@babel/types'
import { containsNulCharacter, sanitizeForJsonb } from '@sim/utils/string'
import type { BlockKey } from '../model'
import type { Reporter } from './report'

/** The index of the first character `sanitizeForJsonb` would replace, or `-1`. */
function firstUnstorable(text: string): number {
  const safe = sanitizeForJsonb(text)
  if (safe === text) return -1
  for (let index = 0; index < text.length; index++) {
    if (safe[index] !== text[index]) return index
  }
  return -1
}

function characterName(character: string): string {
  return containsNulCharacter(character) ? 'a NUL character' : 'an unpaired UTF-16 surrogate'
}

/**
 * Reports the first unstorable character in `text`, a whole file the reporter already holds, so
 * the diagnostic gets its line; `false` when there is one. `blockKey` names the block reading a
 * code file.
 */
export function checkStorableText(
  file: string,
  text: string,
  reporter: Reporter,
  blockKey?: BlockKey
): boolean {
  const index = firstUnstorable(text)
  if (index === -1) return true
  reporter.report(
    'E_INVALID_CHARACTER',
    `The file holds ${characterName(text.charAt(index))}, which a workflow cannot store.`,
    { file, start: index, end: index + 1 },
    {
      hint: 'Remove it; write a whole character (an emoji is two code units) or none.',
      ...(blockKey !== undefined && { blockKey }),
    }
  )
  return false
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && !Array.isArray(value)
}

/** The value a literal node reads as: a string literal's, a template quasi's cooked text. */
function literalValue(node: Node): string | null {
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateElement') return node.value.cooked ?? null
  return null
}

/**
 * A decimal literal's significant digits and the exponent of the first (`1.50e3` → `15e3`), so two
 * spellings of one number compare equal.
 */
function significantDigits(decimal: string): string {
  const [mantissa, exponent = '0'] = decimal.toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const all = whole + fraction
  const leadingZeros = all.length - all.replace(/^0+/, '').length
  const digits = all.slice(leadingZeros).replace(/0+$/, '')
  if (!digits) return '0'
  return `${digits}e${whole.length - leadingZeros - 1 + Number(exponent)}`
}

/** Whether a numeric literal's value differs from the number its source text writes. */
function losesPrecision(raw: string, value: number): boolean {
  const text = raw.replaceAll('_', '')
  if (/^0[xob]/i.test(text)) return BigInt(text) !== BigInt(value)
  if (/^0[0-9]+$/.test(text)) return false
  return significantDigits(text) !== significantDigits(value.toExponential())
}

/**
 * `E_NUMBER_NOT_FINITE` for a literal that reads as `Infinity`, `W_NUMBER_PRECISION` for one
 * whose digits a double cannot hold.
 */
function checkNumber(file: string, node: NumericLiteral, reporter: Reporter): void {
  const start = node.start ?? 0
  const at = { file, start, end: node.end ?? start }
  if (!Number.isFinite(node.value)) {
    reporter.report('E_NUMBER_NOT_FINITE', 'This number is too large to store.', at, {
      hint: 'Write a number within ±1.7976931348623157e308, or a string.',
    })
    return
  }
  const raw = node.extra?.raw
  if (typeof raw === 'string' && losesPrecision(raw, node.value)) {
    reporter.report(
      'W_NUMBER_PRECISION',
      `This number is stored as ${node.value}, losing digits.`,
      at,
      { hint: `Write it as a string: '${raw}'.` }
    )
  }
}

/**
 * Reports every string or template literal whose value holds an unstorable character its source
 * text does not (an escape). Raw characters are `checkStorableText`'s, so none reports twice.
 */
export function checkStorableLiterals(
  file: string,
  text: string,
  ast: File,
  reporter: Reporter
): void {
  const stack: unknown[] = [ast.program]
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      stack.push(...current)
      continue
    }
    if (!isNode(current)) continue
    const node = current
    if (node.type === 'NumericLiteral') {
      checkNumber(file, node, reporter)
      continue
    }
    const value = literalValue(node)
    if (value !== null) {
      const index = firstUnstorable(value)
      const start = node.start ?? 0
      const end = node.end ?? start
      if (index !== -1 && firstUnstorable(text.slice(start, end)) === -1) {
        reporter.report(
          'E_INVALID_CHARACTER',
          `This string holds ${characterName(value.charAt(index))}, which a workflow cannot store.`,
          { file, start, end },
          { hint: 'Remove the escape; write a whole character (\\u{1F600}) or none.' }
        )
      }
      continue
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
      if (key === 'innerComments' || key === 'extra') continue
      if (typeof child === 'object' && child !== null) stack.push(child)
    }
  }
}

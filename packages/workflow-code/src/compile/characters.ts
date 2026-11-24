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
import { childNodes } from '../babel'
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
  let start = 0
  while (start < all.length && all[start] === '0') start += 1
  // A backwards scan, not `/0+$/`, which retries from every zero of a long run.
  let end = all.length
  while (end > start && all[end - 1] === '0') end -= 1
  const leadingZeros = start
  const digits = all.slice(start, end)
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
  const stack: Node[] = [ast.program]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
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
    for (const child of childNodes(node)) stack.push(child)
  }
}

/**
 * Scripts whose letters pass for Latin ones (`а` U+0430 is Cyrillic, `ο` U+03BF Greek), so a word
 * mixing one of them with Latin reads as a Latin word it is not. Unicode's own script property
 * decides, so no confusables table is needed.
 */
const LOOKALIKE_SCRIPTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Cherokee', /\p{Script=Cherokee}/u],
]

/** The {@link LOOKALIKE_SCRIPTS} script `character` belongs to, or `null`. */
export function scriptName(character: string): string | null {
  return LOOKALIKE_SCRIPTS.find(([, pattern]) => pattern.test(character))?.[0] ?? null
}

/**
 * The first character of `text` that puts a second script into a word of Latin letters (`С` in
 * `Сlaude`), with its script; `null` when every word keeps to one script. Words are runs of
 * letters, so `Send to Москва` (two words, one script each) is fine.
 */
export function mixedScriptCharacter(text: string): { character: string; script: string } | null {
  for (const word of text.normalize('NFC').match(/\p{L}+/gu) ?? []) {
    const letters = [...word].map((character) => ({ character, script: scriptName(character) }))
    if (!letters.some(({ script }) => script === 'Latin')) continue
    const other = letters.find(({ script }) => script !== null && script !== 'Latin')
    if (other?.script) return { character: other.character, script: other.script }
  }
  return null
}

/** `U+0421`: a character's code point as Unicode writes it. */
export function codePointLabel(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
}

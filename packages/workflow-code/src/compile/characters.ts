/**
 * Characters a workflow cannot store: NUL, which Postgres `jsonb` rejects outright, and unpaired
 * UTF-16 surrogates, which have no UTF-8 encoding. Either one reaching `workflow_blocks` or
 * `workflow_source_meta` fails the write, so compile refuses them with a located diagnostic. The
 * raw text covers comments and code files; the literal pass covers escapes (`'\u0000'`,
 * `'\uD800'`) that only appear once a string is read.
 */

import type { File, Node } from '@babel/types'
import { containsNulCharacter, sanitizeForJsonb } from '@sim/utils/string'
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

/** Reports the first unstorable character in `text`, a whole file; `false` when there is one. */
export function checkStorableText(file: string, text: string, reporter: Reporter): boolean {
  const index = firstUnstorable(text)
  if (index === -1) return true
  reporter.report(
    'E_INVALID_CHARACTER',
    `The file holds ${characterName(text.charAt(index))}, which a workflow cannot store.`,
    { file, start: index, end: index + 1 },
    { hint: 'Remove it; write a whole character (an emoji is two code units) or none.' }
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

/**
 * The Babel AST walk and error reading shared by the compiler and the code-file reader.
 */

import type { Node } from '@babel/types'

/** The fields a thrown or recovered Babel error may carry. */
export interface BabelErrorShape {
  message?: unknown
  pos?: unknown
  loc?: { line?: unknown; column?: unknown }
}

/** A thrown value read as a Babel error; anything that is not an object reads as `{}`. */
export function babelErrorShape(error: unknown): BabelErrorShape {
  return typeof error === 'object' && error !== null ? error : {}
}

const SKIPPED_KEYS = new Set([
  'leadingComments',
  'trailingComments',
  'innerComments',
  'loc',
  'extra',
])

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

/** Every child AST node of `node`, in no particular order. */
export function childNodes(node: Node): Node[] {
  const children: Node[] = []
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) children.push(item)
    } else if (isNode(value)) {
      children.push(value)
    }
  }
  return children
}

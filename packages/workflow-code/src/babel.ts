/**
 * The Babel AST walk and error reading shared by the compiler and the code-file reader.
 */

import type { MemberExpression, Node } from '@babel/types'
import { isIndexSegment, isNameSegment, type RefSegment } from './code-files/ref-path'

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

/** The name a member access reads: `.name` or `['name']` (optional or not); `null` otherwise. */
export function memberName(node: Node): string | null {
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null
  if (!node.computed && node.property.type === 'Identifier') return node.property.name
  return node.property.type === 'StringLiteral' ? node.property.value : null
}

/**
 * The reference path segment a member access writes: `.name`, `['name']` or `[0]`; `null` for any
 * other property, which no stored reference path can spell.
 */
export function memberSegment(member: MemberExpression): RefSegment | null {
  const property = member.property
  if (!member.computed) {
    return property.type === 'Identifier' && isNameSegment(property.name)
      ? { kind: 'name', name: property.name }
      : null
  }
  if (property.type === 'StringLiteral' && isNameSegment(property.value)) {
    return { kind: 'name', name: property.value }
  }
  if (property.type === 'NumericLiteral' && isIndexSegment(property.value)) {
    return { kind: 'index', index: property.value }
  }
  return null
}

/** A string literal, or a template literal with no `${}`; `null` otherwise. */
export function literalText(node: Node): string | null {
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null
  }
  return null
}

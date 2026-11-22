import { isRecordLike } from '@sim/utils/object'
import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
} from '@sim/utils/workflow-references'
import {
  isReservedWorkflowBlockName,
  normalizeWorkflowBlockName,
} from '@sim/workflow-types/workflow'
import { diagnostic } from '../diagnostics/factory'
import type { Json, ResourceKind, ResourceNode, UnresolvedNode, Value } from '../model'
import { setOwn } from '../records'
import type { CanonContext } from './context'

/** The executor's candidate pattern (`createReferencePattern`); each match is then vetted. */
export const REFERENCE_CANDIDATE = /<([^<>]+)>/g
const VARIABLE_PREFIX = 'variable'

/**
 * Coerces a stored value to JSON. Stored state is jsonb, so this only drops `undefined` object
 * members and maps `undefined` array items to `null` (what `JSON.stringify` writes).
 */
export function toJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : toJson(item)))
  if (isRecordLike(value)) {
    const result: Record<string, Json> = {}
    for (const [key, member] of Object.entries(value)) {
      if (member !== undefined) setOwn(result, key, toJson(member))
    }
    return result
  }
  return null
}

/**
 * Rewrites reference prefixes to the form the resolvers already match:
 * `<Agent 1.content>` → `<agent1.content>` when `agent1` is a block, and `<variable.<id>>` or
 * `<variable.My Var>` → `<variable.myvar>`. Both are semantics-preserving because the block
 * resolver looks names up normalized (`BlockResolver`) and the workflow resolver matches a
 * variable by normalized name or id (resolvers/workflow.ts). Tokens the executor would not
 * treat as references, and references that resolve to nothing, are left verbatim.
 */
function rewriteReferences(text: string, context: CanonContext): string {
  if (!text.includes('<')) return text
  return text.replace(REFERENCE_CANDIDATE, (match: string, inner: string) => {
    if (!isLikelyWorkflowReferenceSegment(match)) return match
    const dot = inner.indexOf('.')
    const prefix = dot === -1 ? inner : inner.slice(0, dot)
    if (prefix === VARIABLE_PREFIX && dot !== -1) {
      return rewriteVariableReference(match, inner.slice(dot + 1), context)
    }
    if (isReservedWorkflowBlockName(prefix)) return match
    const normalized = normalizeWorkflowBlockName(prefix)
    if (normalized === prefix || !context.referenceableKeys.has(normalized)) return match
    return `<${normalized}${dot === -1 ? '' : inner.slice(dot)}>`
  })
}

function rewriteVariableReference(match: string, rest: string, context: CanonContext): string {
  const end = rest.search(/[.[]/)
  const name = end === -1 ? rest : rest.slice(0, end)
  const normalized = normalizeWorkflowBlockName(name)
  const target = context.variables.find(
    (entry) => entry.normalizedName === normalized || entry.id === name
  )
  if (!target || target.key === name) return match
  // A collision loser (`key~2`) is not addressable by name; keep the stored form.
  const firstByName = context.variables.find((entry) => entry.normalizedName === target.key)
  if (firstByName !== target) return match
  return `<variable.${target.key}${end === -1 ? '' : rest.slice(end)}>`
}

/**
 * Converts stored JSON to a model `Value`: strings get their references rewritten, and an object
 * that already carries a `$sim` key is wrapped as a `literal` node so the encoding stays a
 * bijection. A literal's content is kept verbatim.
 */
export function toValue(value: unknown, context: CanonContext): Value {
  if (typeof value === 'string') return rewriteReferences(value, context)
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : toValue(item, context)))
  }
  if (isRecordLike(value)) {
    if (Object.hasOwn(value, '$sim')) return { $sim: 'literal', value: toJson(value) }
    const result: Record<string, Value> = {}
    for (const [key, member] of Object.entries(value)) {
      if (member !== undefined) setOwn(result, key, toValue(member, context))
    }
    return result
  }
  return toJson(value)
}

function containsReferenceToken(text: string): boolean {
  return findWorkflowReferenceTokens(text).length > 0
}

/**
 * Lifts a stored resource id to its key through the resolver. An id the
 * resolver cannot map, or any id when no resolver is supplied, stays verbatim as an `unresolved`
 * node; only a resolver miss is reported (`W_CANON_UNRESOLVED_ID`).
 */
export function liftResourceId(
  kind: ResourceKind,
  id: string,
  context: CanonContext,
  location: { blockKey: string; param: string }
): ResourceNode | UnresolvedNode {
  const key = context.resources?.toKey(kind, id) ?? null
  if (key !== null) return { $sim: 'resource', kind, key }
  if (context.resources) {
    context.diagnostics.push(
      diagnostic('W_CANON_UNRESOLVED_ID', `No ${kind} key for stored id "${id}"; kept verbatim`, {
        blockKey: location.blockKey,
        param: location.param,
      })
    )
  }
  return { $sim: 'unresolved', kind, id }
}

/**
 * The resource-site form of a selector value: a non-empty id string, or
 * a list of them, becomes resource nodes. A multi-select selector that stored several ids as one
 * comma-joined string becomes a `csv` node. A value holding a reference or env token is not an id
 * and stays a value (`undefined` here).
 */
export function liftResourceValue(
  kind: ResourceKind,
  value: unknown,
  context: CanonContext,
  location: { blockKey: string; param: string },
  multiple = false
): Value | undefined {
  const isId = (item: unknown): item is string =>
    typeof item === 'string' && item.trim() !== '' && !containsReferenceToken(item)
  if (multiple && typeof value === 'string' && value.includes(',')) {
    const parts = value.split(',').map((part) => part.trim())
    if (!parts.every(isId)) return undefined
    return {
      $sim: 'csv',
      items: parts.map((part) => liftResourceId(kind, part, context, location)),
    }
  }
  if (isId(value)) return liftResourceId(kind, value, context, location)
  if (Array.isArray(value) && value.length > 0 && value.every(isId)) {
    return value.map((item) => liftResourceId(kind, item, context, location))
  }
  return undefined
}

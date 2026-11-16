import { isRecordLike } from '@sim/utils/object'
import type {
  CatalogBlock,
  CatalogCondition,
  CatalogSubBlock,
  CatalogValueKind,
  SubBlockConditionClause,
} from '../catalog/types'
import type { CanonicalParamId, SubBlockId, Value } from '../model'

/**
 * One source param: a single subBlock, or every subBlock sharing a `canonicalParamId`, written
 * once under that id (build-spec decision 7). A group may lack either member.
 */
export type CatalogField =
  | { kind: 'single'; param: string; sub: CatalogSubBlock }
  | {
      kind: 'pair'
      param: CanonicalParamId
      basic: CatalogSubBlock | undefined
      advanced: CatalogSubBlock | undefined
      members: CatalogSubBlock[]
    }

export interface FieldIndex {
  /** By source param name: subBlock id for singles, canonical id for groups. */
  fields: Map<string, CatalogField>
  /** Group member ids whose own id is not the param name, mapped to that name. */
  memberAliases: Map<SubBlockId, CanonicalParamId>
  /** Every subBlock on this surface by id (first declaration wins). */
  subBlocks: Map<SubBlockId, CatalogSubBlock>
}

function onSurface(sub: CatalogSubBlock, triggerMode: boolean): boolean {
  return triggerMode ? sub.surface !== 'action' : sub.surface !== 'trigger'
}

/**
 * The params a builder accepts: subBlock ids, with every `canonicalParamId` group written once
 * under its canonical id. The surface (action or trigger copy of a duplicated id) follows the
 * block's trigger mode, the first declaration of an id wins, the branches subBlock and the
 * builder's pinned ids are excluded. This is exactly the set the printer emits as params.
 */
export function buildFieldIndex(
  block: CatalogBlock,
  triggerMode: boolean,
  pinned: ReadonlySet<string>
): FieldIndex {
  const subBlocks = new Map<SubBlockId, CatalogSubBlock>()
  for (const sub of block.subBlocks) {
    if (onSurface(sub, triggerMode) && !subBlocks.has(sub.id)) subBlocks.set(sub.id, sub)
  }
  const fields = new Map<string, CatalogField>()
  const memberAliases = new Map<SubBlockId, CanonicalParamId>()
  const branchId = block.graph.branches?.subBlockId
  for (const sub of subBlocks.values()) {
    if (sub.id === branchId || pinned.has(sub.id)) continue
    const cid = sub.canonicalParamId
    if (cid === undefined) {
      fields.set(sub.id, { kind: 'single', param: sub.id, sub })
      continue
    }
    if (sub.id !== cid) memberAliases.set(sub.id, cid)
    if (fields.has(cid)) continue
    const members = [...subBlocks.values()].filter(
      (member) => member.canonicalParamId === cid && !pinned.has(member.id)
    )
    fields.set(cid, {
      kind: 'pair',
      param: cid,
      basic: members.find((member) => member.mode !== 'advanced'),
      advanced: members.find((member) => member.mode === 'advanced'),
      members,
    })
  }
  return { fields, memberAliases, subBlocks }
}

/** The member a group's value lands in for a mode (the printer's effective member). */
export function memberFor(
  field: Extract<CatalogField, { kind: 'pair' }>,
  mode: 'basic' | 'advanced'
): CatalogSubBlock | undefined {
  return (mode === 'advanced' ? field.advanced : field.basic) ?? field.members[0]
}

function clauseMatches(
  clause: { field: string; value: unknown; not?: boolean },
  values: ReadonlyMap<string, Value>
): boolean {
  const actual = values.get(clause.field)
  if (Array.isArray(clause.value)) {
    if (actual === undefined || actual === null) return false
    const included = clause.value.some((candidate) => candidate === actual)
    return clause.not ? !included : included
  }
  return clause.not ? actual !== clause.value : actual === clause.value
}

/**
 * Evaluates a subBlock condition the way the editor does (`evaluateSubBlockCondition`,
 * lib/workflows/subblocks/visibility.ts). An opaque function condition uses the projection's
 * per-operation answer, and counts as visible when there is none (s1 canonicalize step 9).
 */
function conditionHolds(
  condition: CatalogCondition | undefined,
  values: ReadonlyMap<string, Value>,
  visibleFor: Record<string, boolean> | undefined
): boolean {
  if (!condition) return true
  if ('opaque' in condition) {
    const operation = values.get('operation')
    if (typeof operation === 'string' && visibleFor && Object.hasOwn(visibleFor, operation)) {
      return visibleFor[operation]
    }
    return true
  }
  const clause: SubBlockConditionClause = condition
  if (!clauseMatches(clause, values)) return false
  return clause.and ? clauseMatches(clause.and, values) : true
}

export function isVisible(sub: CatalogSubBlock, values: ReadonlyMap<string, Value>): boolean {
  return conditionHolds(sub.condition, values, sub.visibleFor)
}

export function isRequired(sub: CatalogSubBlock, values: ReadonlyMap<string, Value>): boolean {
  if (sub.defaultValue !== undefined || sub.valueDefault !== undefined) return false
  if (sub.hidden || sub.readOnly) return false
  if (sub.required === undefined || sub.required === false) return false
  if (sub.required === true) return true
  return conditionHolds(sub.required, values, undefined)
}

function isPlainObject(value: Value): boolean {
  return isRecordLike(value) && !('$sim' in value)
}

/**
 * Whether a literal value has the JSON type its field's `valueKind` expects. Never coerced: a
 * mismatch is `W_VALUE_KIND` and the exact value is kept (s3 §4 "Catalog checks").
 */
export function valueKindMatches(kind: CatalogValueKind, value: Value): boolean {
  switch (kind) {
    case 'string':
    case 'code':
    case 'picked':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    case 'resource':
      return typeof value === 'object' && value !== null && '$sim' in value
    default:
      return true
  }
}

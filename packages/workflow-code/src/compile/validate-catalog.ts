import { isRecordLike } from '@sim/utils/object'
import { type ConditionLookup, evaluateClause, evaluateCondition } from '../catalog/conditions'
import { isAdvancedMember, onSurface } from '../catalog/surface'
import type {
  BlockCatalog,
  CatalogBlock,
  CatalogBuilder,
  CatalogOutput,
  CatalogSubBlock,
  CatalogValueKind,
} from '../catalog/types'
import { catalogTrigger } from '../catalog/view'
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
    if (onSurface(block, sub, triggerMode) && !subBlocks.has(sub.id)) subBlocks.set(sub.id, sub)
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
      basic: members.find((member) => !isAdvancedMember(member)),
      advanced: members.find(isAdvancedMember),
      members,
    })
  }
  return { fields, memberAliases, subBlocks }
}

/**
 * A group with both a basic and an advanced member: the only kind whose mode the CWM records
 * (`isCanonicalPair`), so `modes` holds exactly these on the block's surface.
 */
export function isModalPair(field: CatalogField): boolean {
  return field.kind === 'pair' && field.basic !== undefined && field.advanced !== undefined
}

/** The member a group's value lands in for a mode (the printer's effective member). */
export function memberFor(
  field: Extract<CatalogField, { kind: 'pair' }>,
  mode: 'basic' | 'advanced'
): CatalogSubBlock | undefined {
  return (mode === 'advanced' ? field.advanced : field.basic) ?? field.members[0]
}

/** A lookup over a block's compiled params, every one of them known. */
function paramLookup(values: ReadonlyMap<string, Value>): ConditionLookup {
  return (field: string) => ({ value: values.get(field) })
}

/** Whether a field may be shown: only a field the catalog's data decides hidden is not. */
export function isVisible(sub: CatalogSubBlock, values: ReadonlyMap<string, Value>): boolean {
  return evaluateCondition(sub, paramLookup(values)) !== false
}

/**
 * The output schemas a declared block can expose. A trigger-mode builder runs as its trigger, so
 * its outputs are that trigger's (the builder's pinned `selectedTriggerId`, else every trigger the
 * block offers) besides the block's own; any other block exposes its own outputs.
 */
export function outputSchemasFor(
  catalog: BlockCatalog,
  block: CatalogBlock,
  builder: CatalogBuilder | undefined
): Array<Record<string, CatalogOutput>> {
  if (!builder?.triggerMode) return [block.outputs]
  const pinned = builder.fixed?.selectedTriggerId
  const ids = pinned !== undefined ? [pinned] : (block.triggers?.available ?? [])
  const schemas = [block.outputs]
  for (const id of ids) {
    const trigger = catalogTrigger(catalog, id)
    if (trigger) schemas.push(trigger.outputs)
  }
  return schemas
}

/**
 * The fields a block leaves empty although they are required under the values it runs with
 * (`W_REQUIRED_MISSING`). `values` are the block's compiled params, which already hold each
 * omitted field's editor default (`catalog/defaults.ts` `editorDefaults`, the one source of what
 * an omitted param means), so an omitted Slack `destinationType` reads as the `'channel'` the
 * canvas writes. A field counts when no member holds a value and some member is certainly visible
 * and certainly required under those values: a provider's credential fields never count for a
 * model of another provider, and the half of a channel/DM switch the block does not use never
 * counts. The server's lint, which runs the registry's own conditions, still reports what this
 * static check cannot decide.
 */
export function missingRequiredFields(
  index: FieldIndex,
  values: ReadonlyMap<string, Value>,
  isWritten: (subBlockId: SubBlockId) => boolean
): CatalogField[] {
  const missing: CatalogField[] = []
  for (const field of index.fields.values()) {
    const members = field.kind === 'single' ? [field.sub] : field.members
    if (members.some((sub) => isWritten(sub.id))) continue
    const lookup = paramLookup(values)
    if (members.some((sub) => evaluateCondition(sub, lookup) === true && isRequired(sub, values))) {
      missing.push(field)
    }
  }
  return missing
}

/** Whether a field certainly needs a value: an opaque `required` function is not decided. */
function isRequired(sub: CatalogSubBlock, values: ReadonlyMap<string, Value>): boolean {
  if (sub.defaultValue !== undefined || sub.valueDefault !== undefined) return false
  if (sub.hidden || sub.readOnly) return false
  if (sub.required === undefined || sub.required === false) return false
  if (sub.required === true) return true
  if ('opaque' in sub.required) return false
  return evaluateClause(sub.required, paramLookup(values)) === true
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

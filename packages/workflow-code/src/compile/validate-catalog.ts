import { isRecordLike } from '@sim/utils/object'
import type {
  BlockCatalog,
  CatalogBlock,
  CatalogBuilder,
  CatalogOutput,
  CatalogSubBlock,
  CatalogValueKind,
  SubBlockConditionClause,
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

/** A trigger block (`category: 'triggers'`) serializes both surfaces (`shouldSerializeSubBlock`). */
function onSurface(block: CatalogBlock, sub: CatalogSubBlock, triggerMode: boolean): boolean {
  if (block.category === 'triggers') return true
  return triggerMode ? sub.surface !== 'action' : sub.surface !== 'trigger'
}

function isAdvancedMember(sub: CatalogSubBlock): boolean {
  return sub.mode === 'advanced' || sub.mode === 'trigger-advanced'
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
 * Evaluates a data condition the way the editor does (`evaluateSubBlockCondition`,
 * lib/workflows/subblocks/visibility.ts).
 */
function conditionHolds(
  clause: SubBlockConditionClause,
  values: ReadonlyMap<string, Value>
): boolean {
  if (!clauseMatches(clause, values)) return false
  return clause.and ? clauseMatches(clause.and, values) : true
}

/** Whether the catalog's data decides a field shown, hidden, or cannot tell. */
type Visibility = 'visible' | 'hidden' | 'undecided'

/**
 * Visibility under `values`. A data condition is evaluated as the editor does. An opaque one is
 * decided only by the data the catalog precomputed for it:
 * - per operation, `visibleFor` (hidden when false) and the clause `visibleWhen` still asks then
 *   (absent: shown);
 * - per model, `visibleForModel`, for a model that is one of the block's literal options. A model
 *   held as a reference or template, or not offered, is undecided.
 * Anything else is undecided: field checks never warn on a field they cannot place.
 */
function visibility(sub: CatalogSubBlock, values: ReadonlyMap<string, Value>): Visibility {
  const condition = sub.condition
  if (!condition) return 'visible'
  if (!('opaque' in condition)) {
    return conditionHolds(condition, values) ? 'visible' : 'hidden'
  }
  const operation = values.get('operation')
  if (typeof operation === 'string' && sub.visibleFor && Object.hasOwn(sub.visibleFor, operation)) {
    if (!sub.visibleFor[operation]) return 'hidden'
    const asked = sub.visibleWhen?.[operation]
    if (!asked) return 'visible'
    return conditionHolds(asked, values) ? 'visible' : 'hidden'
  }
  const model = values.get('model')
  if (
    typeof model === 'string' &&
    sub.visibleForModel &&
    Object.hasOwn(sub.visibleForModel, model)
  ) {
    return sub.visibleForModel[model] ? 'visible' : 'hidden'
  }
  return 'undecided'
}

/** Whether a field may be shown: only a field the catalog's data decides hidden is not. */
export function isVisible(sub: CatalogSubBlock, values: ReadonlyMap<string, Value>): boolean {
  return visibility(sub, values) !== 'hidden'
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
    if (members.some((sub) => visibility(sub, values) === 'visible' && isRequired(sub, values))) {
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
  return conditionHolds(sub.required, values)
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

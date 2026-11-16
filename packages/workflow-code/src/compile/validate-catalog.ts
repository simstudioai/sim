import { type ConditionLookup, evaluateClause, evaluateCondition } from '../catalog/conditions'
import { isAdvancedMember, onSurface, paramAliases } from '../catalog/surface'
import type {
  BlockCatalog,
  CatalogBlock,
  CatalogBuilder,
  CatalogOutput,
  CatalogSubBlock,
  CatalogValueKind,
} from '../catalog/types'
import { catalogTrigger } from '../catalog/view'
import { type CanonicalParamId, isPlainRecord, type SubBlockId, type Value } from '../model'

/**
 * One source param: a single subBlock, or every subBlock sharing a `canonicalParamId`, written
 * once under that id. A group may lack either member. `param` is the
 * subBlock id or canonical id (what `modes` is keyed by); `name` is what source writes, the
 * param's alias when the catalog gives one (`paramAliases`), else `param`.
 */
export type CatalogField =
  | { kind: 'single'; param: string; name: string; sub: CatalogSubBlock }
  | {
      kind: 'pair'
      param: CanonicalParamId
      name: string
      basic: CatalogSubBlock | undefined
      advanced: CatalogSubBlock | undefined
      members: CatalogSubBlock[]
    }

export interface FieldIndex {
  /** By written name: the alias, else the subBlock id for singles or canonical id for groups. */
  fields: Map<string, CatalogField>
  /** Params written under an alias, by their own name: compile accepts both spellings. */
  aliased: Map<string, CatalogField>
  /** Group member ids whose own id is not the written name, mapped to that name. */
  memberAliases: Map<SubBlockId, string>
  /** Every subBlock on this surface by id (first declaration wins). */
  subBlocks: Map<SubBlockId, CatalogSubBlock>
}

/** The field a written param name targets: its written name or, when aliased, its own name. */
export function fieldFor(index: FieldIndex, key: string): CatalogField | undefined {
  return index.fields.get(key) ?? index.aliased.get(key)
}

/**
 * The params a builder accepts: subBlock ids, with every `canonicalParamId` group written once
 * under its canonical id, each under its alias when the catalog gives one. The surface (action or
 * trigger copy of a duplicated id) follows the block's trigger mode, the first declaration of an
 * id wins, the branches subBlock and the builder's pinned ids are excluded. This is exactly the
 * set the printer emits as params.
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
  const aliases = paramAliases(block, triggerMode)
  const fields = new Map<string, CatalogField>()
  const aliased = new Map<string, CatalogField>()
  const memberAliases = new Map<SubBlockId, string>()
  const add = (field: CatalogField) => {
    fields.set(field.name, field)
    if (field.name !== field.param) aliased.set(field.param, field)
  }
  const branchId = block.graph.branches?.subBlockId
  for (const sub of subBlocks.values()) {
    if (sub.id === branchId || pinned.has(sub.id)) continue
    const cid = sub.canonicalParamId
    if (cid === undefined) {
      add({ kind: 'single', param: sub.id, name: aliases.get(sub.id) ?? sub.id, sub })
      continue
    }
    const name = aliases.get(cid) ?? cid
    if (sub.id !== name) memberAliases.set(sub.id, name)
    if (fields.has(name)) continue
    const members = [...subBlocks.values()].filter(
      (member) => member.canonicalParamId === cid && !pinned.has(member.id)
    )
    add({
      kind: 'pair',
      param: cid,
      name,
      basic: members.find((member) => !isAdvancedMember(member)),
      advanced: members.find(isAdvancedMember),
      members,
    })
  }
  return { fields, aliased, memberAliases, subBlocks }
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

/**
 * Whether a literal value has the JSON type its field's `valueKind` expects. Never coerced: a
 * mismatch is `W_VALUE_KIND` and the exact value is kept.
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
      return isPlainRecord(value)
    case 'resource':
      return typeof value === 'object' && value !== null && '$sim' in value
    default:
      return true
  }
}

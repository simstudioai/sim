/**
 * Which declarations a block uses: the surface half of `shouldSerializeSubBlock`
 * (apps/sim/serializer/index.ts). A block that is both an action and a trigger declares both
 * surfaces in one `subBlocks` list, sometimes under the same id; the trigger-mode fields serve a
 * block in trigger mode, every other field a block in action mode, and a trigger block
 * (`category: 'triggers'`) uses both. Every reader of the catalog (canonicalize, compile, print,
 * SDK codegen, the catalog projection) asks here.
 */

import { compareStrings } from '@sim/utils/string'
import { SYSTEM_SUBBLOCK_IDS } from '@sim/workflow-types/blocks'
import type { CanonicalParamId, SubBlockId } from '../model'
import { buildCanonicalIndex, type CanonicalIndex } from './canonical-index'
import {
  type ConditionLookup,
  evaluateClause,
  evaluateCondition,
  isConditionClause,
} from './conditions'
import { subBlockEditorDefault } from './defaults'
import type { CatalogBlock, CatalogBuilder, CatalogSubBlock } from './types'

/** The fields this rule reads; a registry `SubBlockConfig` fits as well as a `CatalogSubBlock`. */
type SurfaceFields = Partial<Pick<CatalogSubBlock, 'surface'>> & { mode?: string }

/**
 * Whether a declaration is a trigger-mode field: tagged so by the catalog (`surface`, which also
 * marks the trigger subBlocks a block spreads in), else by its `trigger` / `trigger-advanced` mode.
 */
export function isTriggerSurface(subBlock: SurfaceFields): boolean {
  if (subBlock.surface !== undefined) return subBlock.surface === 'trigger'
  return subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced'
}

/**
 * Trigger subBlocks source never states: the shared system set (setup text, sample payloads, the
 * webhook URL display, schedule info) minus the credential, which source writes, plus the
 * server-owned trigger path.
 */
const UNWRITTEN_SUBBLOCK_IDS: ReadonlySet<string> = new Set([
  ...SYSTEM_SUBBLOCK_IDS.filter((id) => id !== 'triggerCredentials'),
  'triggerPath',
])

/**
 * Whether source states this declaration's value: not a hidden field, a tool-input-only field, a
 * display-only one (`valueKind: 'none'`: text, read-only, schedule info) or a trigger system field.
 * SDK codegen types exactly these; print leaves every other stored value out of source and compile
 * keeps it from the stored block, so it still round-trips as stored state.
 */
export function isWrittenInSource(
  subBlock: Pick<CatalogSubBlock, 'id' | 'hidden' | 'context' | 'valueKind'>
): boolean {
  if (subBlock.hidden || subBlock.context === 'tool-input' || subBlock.valueKind === 'none') {
    return false
  }
  return !UNWRITTEN_SUBBLOCK_IDS.has(subBlock.id) && !subBlock.id.startsWith('samplePayload')
}

const pinsByBuilder = new WeakMap<CatalogBuilder, ReadonlyMap<SubBlockId, string>>()

/**
 * The param values a builder pins: its `operation` (when it has one), then its `fixed` entries,
 * which win over the operation as compile stores them. Print leaves these out of the params,
 * compile sets them (writing one is `E_FIXED_PARAM`), and SDK codegen leaves them out of the
 * params type, so all three agree on which params a builder takes. Empty for no builder.
 */
export function builderPins(builder: CatalogBuilder | undefined): ReadonlyMap<SubBlockId, string> {
  if (!builder) return new Map()
  const known = pinsByBuilder.get(builder)
  if (known) return known
  const pins = new Map<SubBlockId, string>()
  if (builder.operation !== undefined) pins.set('operation', builder.operation)
  for (const [id, value] of Object.entries(builder.fixed ?? {})) pins.set(id, value)
  pinsByBuilder.set(builder, pins)
  return pins
}

/**
 * Whether a builder's params type declares a param with these declarations: one of them is
 * written in source and its condition is not false under the values the builder pins (its
 * `operation` and `fixed` entries) alone. SDK codegen leaves every other param out of the type, so
 * print writes a stored value of a written one under `meta.extra`, and compile takes it there.
 */
export function typedForBuilder(
  declarations: ReadonlyArray<CatalogSubBlock>,
  pinned: Readonly<Record<string, unknown>>
): boolean {
  const lookup = pinnedLookup(pinned)
  return declarations.some(
    (declaration) =>
      isWrittenInSource(declaration) && evaluateCondition(declaration, lookup) !== false
  )
}

/** Controls that always hold a value (first option, off, minimum), so never required. */
const ALWAYS_VALUED_TYPES: ReadonlySet<string> = new Set(['dropdown', 'switch', 'slider'])

/** Whether a param holds a value without source writing one: a default, or an always-valued control. */
export function hasDefaultValue(declarations: ReadonlyArray<CatalogSubBlock>): boolean {
  return declarations.some(
    (declaration) =>
      declaration.defaultValue !== undefined ||
      (declaration.valueDefault !== undefined && 'constant' in declaration.valueDefault) ||
      subBlockEditorDefault(declaration) !== undefined ||
      ALWAYS_VALUED_TYPES.has(declaration.type)
  )
}

/**
 * Whether a builder's params type requires a param with these declarations: none holds a default,
 * and one written in source is shown and required under the builder's pinned values alone (a
 * function condition counts only where the catalog's per-operation data decides it). SDK codegen
 * marks exactly these required.
 */
export function requiredForBuilder(
  declarations: ReadonlyArray<CatalogSubBlock>,
  pinned: Readonly<Record<string, unknown>>
): boolean {
  return requiredUnder(declarations, pinnedLookup(pinned))
}

/**
 * Whether a block of type `block` holding `values` must write a param with these declarations:
 * what {@link requiredForBuilder} requires, and what the variant its values select requires
 * (Slack's `channel` when `destinationType` is not `dm`). Only the fields SDK codegen enumerates
 * into variants are read (static dropdowns and switches), so this never asks for more than the
 * builder's type does. The printer writes `todo()` for one with no stored value.
 */
export function requiredForValues(
  block: Pick<CatalogBlock, 'subBlocks'>,
  declarations: ReadonlyArray<CatalogSubBlock>,
  values: Readonly<Record<string, unknown>>
): boolean {
  return requiredUnder(declarations, (field) =>
    isEnumerable(block.subBlocks, field) ? { value: values[field] } : undefined
  )
}

/** Per subBlock list, the fields {@link isEnumerable} accepts, computed once per list. */
const enumerableFields = new WeakMap<ReadonlyArray<CatalogSubBlock>, ReadonlySet<string>>()

/**
 * Whether every declaration of `field` holds one of a fixed set of values: a switch, or a
 * single-value dropdown with static options. SDK codegen enumerates exactly these.
 */
export function isEnumerable(subBlocks: ReadonlyArray<CatalogSubBlock>, field: string): boolean {
  let fields = enumerableFields.get(subBlocks)
  if (!fields) {
    const fixed = new Set<string>()
    const open = new Set<string>()
    for (const subBlock of subBlocks) {
      const enumerable =
        subBlock.type === 'switch' ||
        (subBlock.type === 'dropdown' &&
          !subBlock.multiple &&
          Array.isArray(subBlock.options) &&
          subBlock.options.length > 0)
      if (enumerable) fixed.add(subBlock.id)
      else open.add(subBlock.id)
    }
    for (const id of open) fixed.delete(id)
    fields = fixed
    enumerableFields.set(subBlocks, fields)
  }
  return fields.has(field)
}

function requiredUnder(
  declarations: ReadonlyArray<CatalogSubBlock>,
  lookup: ConditionLookup
): boolean {
  if (hasDefaultValue(declarations)) return false
  return declarations.some((declaration) => {
    const { required } = declaration
    if (!isWrittenInSource(declaration)) return false
    if (evaluateCondition(declaration, lookup) !== true) return false
    return (
      required === true ||
      (isConditionClause(required) && evaluateClause(required, lookup) === true)
    )
  })
}

function pinnedLookup(pinned: Readonly<Record<string, unknown>>): ConditionLookup {
  return (field) => (Object.hasOwn(pinned, field) ? { value: pinned[field] } : undefined)
}

/** Whether a block in `triggerMode` uses this declaration. */
export function onSurface(
  block: Pick<CatalogBlock, 'category'>,
  subBlock: SurfaceFields,
  triggerMode: boolean
): boolean {
  return block.category === 'triggers' || isTriggerSurface(subBlock) === triggerMode
}

/** The advanced member of a basic/advanced pair, on either surface. */
function isAdvancedMember(subBlock: Pick<CatalogSubBlock, 'mode'>): boolean {
  return subBlock.mode === 'advanced' || subBlock.mode === 'trigger-advanced'
}

/**
 * The canonical groups of the declarations a block in `triggerMode` uses. Both surfaces may share
 * a `canonicalParamId` under different ids (Gmail's `credential`/`manualCredential` and
 * `triggerCredentials` are all `oauthCredential`); indexed together, the other surface's member
 * would join the pair without being either of its members. This is the serializer's rule; the
 * editor's `buildCanonicalIndexForSurface` filters only the trigger surface and keeps every
 * declaration on the action surface.
 */
export function serializedCanonicalIndex(
  block: Pick<CatalogBlock, 'category' | 'subBlocks'>,
  triggerMode: boolean
): CanonicalIndex {
  let byMode = canonicalIndexMemo.get(block)
  if (!byMode) {
    byMode = new Map()
    canonicalIndexMemo.set(block, byMode)
  }
  const cached = byMode.get(triggerMode)
  if (cached) return cached
  const used = block.subBlocks.filter((subBlock) => onSurface(block, subBlock, triggerMode))
  const index = buildCanonicalIndex(used)
  byMode.set(triggerMode, index)
  return index
}

/** {@link serializedCanonicalIndex} per block and surface; an index is never edited once built. */
const canonicalIndexMemo = new WeakMap<
  Pick<CatalogBlock, 'category' | 'subBlocks'>,
  Map<boolean, CanonicalIndex>
>()

const aliasMemo = new WeakMap<CatalogBlock, Map<boolean, ReadonlyMap<string, string>>>()

/**
 * The aliases a block in `triggerMode` writes its params under: param name (canonical id or
 * subBlock id) → alias, from the catalog's frozen `paramAliases` for the surface the block uses
 * (both for a trigger block). An alias that would name another param on that surface, or a second
 * param, is dropped, so every param keeps exactly one written name. Print writes the alias;
 * compile accepts the alias and the param name.
 */
export function paramAliases(
  block: CatalogBlock,
  triggerMode: boolean
): ReadonlyMap<string, string> {
  let byMode = aliasMemo.get(block)
  if (!byMode) {
    byMode = new Map()
    aliasMemo.set(block, byMode)
  }
  const cached = byMode.get(triggerMode)
  if (cached) return cached
  const names = new Set<string>()
  for (const subBlock of block.subBlocks) {
    if (onSurface(block, subBlock, triggerMode)) names.add(subBlock.canonicalParamId ?? subBlock.id)
  }
  const surfaces: Array<'action' | 'trigger'> =
    block.category === 'triggers' ? ['action', 'trigger'] : [triggerMode ? 'trigger' : 'action']
  const aliases = new Map<string, string>()
  const taken = new Set<string>()
  for (const surface of surfaces) {
    for (const [name, alias] of Object.entries(block.paramAliases?.[surface] ?? {})) {
      if (!names.has(name) || aliases.has(name) || names.has(alias) || taken.has(alias)) continue
      aliases.set(name, alias)
      taken.add(alias)
    }
  }
  byMode.set(triggerMode, aliases)
  return aliases
}

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

/** The params a block surface accepts, indexed by written name, original param name, member id and subBlock id. */
export interface FieldIndex {
  /** By written name: the alias, else the subBlock id for singles or canonical id for groups. */
  fields: ReadonlyMap<string, CatalogField>
  /** Params written under an alias, by their own name: compile accepts both spellings. */
  aliased: ReadonlyMap<string, CatalogField>
  /** Group member ids whose own id is not the written name, mapped to that name. */
  memberAliases: ReadonlyMap<SubBlockId, string>
  /** Every subBlock on this surface by id (first declaration wins). */
  subBlocks: ReadonlyMap<SubBlockId, CatalogSubBlock>
  /**
   * Every declaration on this surface by id, in registry order: a block may declare one id several
   * times under exclusive conditions (ElevenLabs' `modelId` per operation, each with its own
   * options). Read through {@link declarationFor}.
   */
  declarations: ReadonlyMap<SubBlockId, readonly CatalogSubBlock[]>
}

/**
 * The declaration of `id` a block with these values uses: the first one whose condition is not
 * false under `lookup`, else the first one. Only an id declared more than once needs the values.
 */
export function declarationFor(
  index: Pick<FieldIndex, 'declarations'>,
  id: SubBlockId,
  lookup: ConditionLookup
): CatalogSubBlock | undefined {
  const declared = index.declarations.get(id)
  if (!declared || declared.length < 2) return declared?.[0]
  return declared.find((sub) => evaluateCondition(sub, lookup) !== false) ?? declared[0]
}

/** Built indexes by block, then by trigger mode and pinned ids (`fieldIndexKey`). */
const fieldIndexMemo = new WeakMap<CatalogBlock, Map<string, FieldIndex>>()

function fieldIndexKey(triggerMode: boolean, pinned: ReadonlySet<string>): string {
  return [triggerMode ? 'trigger' : 'action', ...[...pinned].sort(compareStrings)].join('\u0000')
}

/**
 * The params a builder accepts: subBlock ids, with every `canonicalParamId` group written once
 * under its canonical id, each under its alias when the catalog gives one. The surface (action or
 * trigger copy of a duplicated id) follows the block's trigger mode, the first declaration of an
 * id stands for the field (`declarationFor` picks the one a block's values use), the branches
 * subBlock and the builder's pinned ids are excluded. This is exactly the set the printer emits as
 * params. Built once per block, trigger mode and pinned ids; the index is shared, so it is
 * read-only.
 */
export function buildFieldIndex(
  block: CatalogBlock,
  triggerMode: boolean,
  pinned: ReadonlySet<string>
): FieldIndex {
  let byKey = fieldIndexMemo.get(block)
  if (!byKey) {
    byKey = new Map()
    fieldIndexMemo.set(block, byKey)
  }
  const key = fieldIndexKey(triggerMode, pinned)
  const known = byKey.get(key)
  if (known) return known
  const index = indexFields(block, triggerMode, pinned)
  byKey.set(key, index)
  return index
}

function indexFields(
  block: CatalogBlock,
  triggerMode: boolean,
  pinned: ReadonlySet<string>
): FieldIndex {
  const subBlocks = new Map<SubBlockId, CatalogSubBlock>()
  const declarations = new Map<SubBlockId, CatalogSubBlock[]>()
  for (const sub of block.subBlocks) {
    if (!onSurface(block, sub, triggerMode)) continue
    if (!subBlocks.has(sub.id)) subBlocks.set(sub.id, sub)
    const declared = declarations.get(sub.id)
    if (declared) declared.push(sub)
    else declarations.set(sub.id, [sub])
  }
  const aliases = paramAliases(block, triggerMode)
  const fields = new Map<string, CatalogField>()
  const aliased = new Map<string, CatalogField>()
  const memberAliases = new Map<SubBlockId, string>()
  const add = (field: CatalogField) => {
    fields.set(field.name, field)
    if (field.name !== field.param) aliased.set(field.param, field)
  }
  /** Each group's unpinned members on this surface, in declaration order. */
  const groupMembers = new Map<CanonicalParamId, CatalogSubBlock[]>()
  for (const sub of subBlocks.values()) {
    const cid = sub.canonicalParamId
    if (cid === undefined || pinned.has(sub.id)) continue
    const members = groupMembers.get(cid)
    if (members) members.push(sub)
    else groupMembers.set(cid, [sub])
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
    const members = groupMembers.get(cid) ?? []
    add({
      kind: 'pair',
      param: cid,
      name,
      basic: members.find((member) => !isAdvancedMember(member)),
      advanced: members.find(isAdvancedMember),
      members,
    })
  }
  return { fields, aliased, memberAliases, subBlocks, declarations }
}

/**
 * A group with both a basic and an advanced member: the only kind whose mode the CWM records
 * (`isCanonicalPair`), so `modes` holds exactly these on the block's surface.
 */
export function isModalPair(field: CatalogField): boolean {
  return field.kind === 'pair' && field.basic !== undefined && field.advanced !== undefined
}

/**
 * Whether `subBlock` is the free-text twin of a saved-credential picker: a member of a canonical
 * pair, among `siblings`, whose other member selects a credential (`manualCredential` beside
 * `credential`). It holds a credential id, so source writes `credential('key')` or a reference,
 * template or env variable that yields one at run time, never literal text (the SDK's
 * `CredentialIdValue`); the printer writes a stored literal id as `raw()`.
 */
export function isCredentialIdTwin(
  subBlock: CatalogSubBlock,
  siblings: ReadonlyArray<CatalogSubBlock>
): boolean {
  const param = subBlock.canonicalParamId
  if (param === undefined || subBlock.resourceKind === 'credential') return false
  return siblings.some(
    (sibling) => sibling.canonicalParamId === param && sibling.resourceKind === 'credential'
  )
}

/** The member a group's value lands in for a mode (the printer's effective member). */
export function memberFor(
  field: Extract<CatalogField, { kind: 'pair' }>,
  mode: 'basic' | 'advanced'
): CatalogSubBlock | undefined {
  return (mode === 'advanced' ? field.advanced : field.basic) ?? field.members[0]
}

/**
 * Which declarations a block uses: the surface half of `shouldSerializeSubBlock`
 * (apps/sim/serializer/index.ts). A block that is both an action and a trigger declares both
 * surfaces in one `subBlocks` list, sometimes under the same id; the trigger-mode fields serve a
 * block in trigger mode, every other field a block in action mode, and a trigger block
 * (`category: 'triggers'`) uses both. Every reader of the catalog (canonicalize, compile, print,
 * SDK codegen, the catalog projection) asks here.
 */

import type { CanonicalParamId, SubBlockId } from '../model'
import { buildCanonicalIndex, type CanonicalIndex } from './canonical-index'
import type { CatalogBlock, CatalogSubBlock } from './types'

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
  const used = block.subBlocks.filter((subBlock) => onSurface(block, subBlock, triggerMode))
  return buildCanonicalIndex(used)
}

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

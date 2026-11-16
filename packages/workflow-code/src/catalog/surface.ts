/**
 * Which declarations a block uses: the surface half of `shouldSerializeSubBlock`
 * (apps/sim/serializer/index.ts). A block that is both an action and a trigger declares both
 * surfaces in one `subBlocks` list, sometimes under the same id; the trigger-mode fields serve a
 * block in trigger mode, every other field a block in action mode, and a trigger block
 * (`category: 'triggers'`) uses both. Every reader of the catalog (canonicalize, compile, print,
 * SDK codegen, the catalog projection) asks here.
 */

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
export function isAdvancedMember(subBlock: Pick<CatalogSubBlock, 'mode'>): boolean {
  return subBlock.mode === 'advanced' || subBlock.mode === 'trigger-advanced'
}

/**
 * The canonical groups of the declarations a block in `triggerMode` uses. Both surfaces may share
 * a `canonicalParamId` under different ids (Gmail's `credential`/`manualCredential` and
 * `triggerCredentials` are all `oauthCredential`); indexed together, the other surface's member
 * would join the pair without being either of its members.
 */
export function buildCanonicalIndexForSurface(
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

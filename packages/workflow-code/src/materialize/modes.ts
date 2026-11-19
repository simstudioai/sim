import { toRecord } from '@sim/utils/object'
import { effectiveModes } from '../canonicalize/modes'
import type { BlockCatalog, CatalogBlock } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import type { CanonicalParamId, CanonicalTool, ParamMode } from '../model'
import { getOwn, setOwn } from '../records'

const INDEX_SCOPED_KEY = /^\d+:/

type ModeMap = Record<string, ParamMode>

/**
 * Block-level modes: an entry is written only where one already existed
 * or where inference over the written values would land on a different mode. Inference follows
 * the serializer: the legacy `advancedMode` flag makes an unset pair advanced, else the member
 * holding a value wins (`effectiveModes`).
 */
export function writeBlockModes(
  modes: ModeMap,
  desired: Record<CanonicalParamId, ParamMode>,
  catalog: CatalogBlock,
  values: Record<string, unknown>,
  triggerMode: boolean,
  advancedMode: boolean
): ModeMap {
  const inferred = effectiveModes(catalog, triggerMode, values, undefined, advancedMode)
  const next = { ...modes }
  for (const [id, mode] of Object.entries(desired)) {
    if (Object.hasOwn(next, id) || getOwn(inferred, id) !== mode) setOwn(next, id, mode)
  }
  return next
}

/**
 * Nested tool modes, rewritten whenever a tool list changed.
 * Every index-scoped `${i}:cid` entry is dropped, as is each legacy `${type}:cid` entry of a type
 * still in the list. Each tool then gets `${i}:cid` where its mode differs from inference over its
 * stored params, or where the prev tool it continues (`prevIndexes`) had an explicit entry, by
 * index or by legacy type key.
 */
export function writeToolModes(
  modes: ModeMap,
  tools: CanonicalTool[],
  storedTools: unknown[],
  prevIndexes: ReadonlyArray<number | undefined>,
  catalog: BlockCatalog
): ModeMap {
  const types = new Set(tools.map((tool) => tool.type))
  const next: ModeMap = {}
  for (const [key, mode] of Object.entries(modes)) {
    if (INDEX_SCOPED_KEY.test(key)) continue
    const separator = key.indexOf(':')
    if (separator !== -1 && types.has(key.slice(0, separator))) continue
    setOwn(next, key, mode)
  }
  tools.forEach((tool, index) => {
    const block = catalogBlock(catalog, tool.type)
    const params = toRecord(toRecord(storedTools[index]).params)
    const inferred = block ? effectiveModes(block, false, params, undefined, false) : {}
    for (const [id, mode] of Object.entries(tool.modes)) {
      const prevIndex = prevIndexes[index]
      const hadExplicit =
        (prevIndex !== undefined && Object.hasOwn(modes, `${prevIndex}:${id}`)) ||
        Object.hasOwn(modes, `${tool.type}:${id}`)
      if (hadExplicit || getOwn(inferred, id) !== mode) next[`${index}:${id}`] = mode
    }
  })
  return next
}

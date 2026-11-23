import { isRecordLike } from '@sim/utils/object'
import {
  type CanonicalModeOverrides,
  isCanonicalPair,
  resolveCanonicalMode,
} from '../catalog/canonical-index'
import { serializedCanonicalIndex } from '../catalog/surface'
import type { BlockCatalog, CatalogBlock } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import type { CanonicalParamId, CanonicalTool, ParamMode } from '../model'
import { getOwn, setOwn } from '../records'

function isParamMode(value: unknown): value is ParamMode {
  return value === 'basic' || value === 'advanced'
}

/** The valid entries of a stored `data.canonicalModes`, or `undefined` when it is not a record. */
export function parseModeMap(value: unknown): Record<string, ParamMode> | undefined {
  if (!isRecordLike(value)) return undefined
  const modes: Record<string, ParamMode> = {}
  for (const [id, mode] of Object.entries(value)) {
    if (isParamMode(mode)) setOwn(modes, id, mode)
  }
  return modes
}

/** Whether a stored `data.canonicalModes` holds only valid entries. */
export function isModeMap(value: unknown): boolean {
  return isRecordLike(value) && Object.values(value).every(isParamMode)
}

/**
 * The effective mode of every canonical pair on the block's surface, as the serializer resolves
 * it (`extractBlockParams`): an explicit override wins;
 * otherwise the legacy block-level `advancedMode` makes a pair advanced; otherwise the mode is
 * inferred from which member holds a value (`resolveCanonicalMode`).
 *
 * Only the pairs the block serializes get a mode: the trigger surface in trigger mode, the action
 * surface otherwise, and both for a trigger block (`shouldSerializeSubBlock`). A pair on the other
 * surface never reaches execution, and the compiler records modes the same way.
 */
export function effectiveModes(
  block: Pick<CatalogBlock, 'category' | 'subBlocks'>,
  triggerMode: boolean,
  values: Record<string, unknown>,
  overrides: CanonicalModeOverrides | undefined,
  legacyAdvancedMode: boolean
): Record<CanonicalParamId, ParamMode> {
  const index = serializedCanonicalIndex(block, triggerMode)
  const modes: Record<CanonicalParamId, ParamMode> = {}
  for (const group of Object.values(index.groupsById)) {
    if (!isCanonicalPair(group)) continue
    const explicit = overrides?.[group.canonicalId] != null
    modes[group.canonicalId] =
      legacyAdvancedMode && !explicit ? 'advanced' : resolveCanonicalMode(group, values, overrides)
  }
  return modes
}

/**
 * A nested tool's modes in canonical form: the effective mode of every pair of the tool's block,
 * resolved over its params with `explicit` winning, as the serializer resolves a tool
 * (`effectiveModes`, action surface). A type the catalog does not know keeps only its explicit
 * entries. Canonicalize, compile and the tool forms all write a tool's modes through this.
 */
export function toolModes(
  catalog: BlockCatalog,
  type: string,
  params: Record<string, unknown>,
  explicit?: CanonicalModeOverrides
): CanonicalTool['modes'] {
  const block = catalogBlock(catalog, type)
  if (block) return effectiveModes(block, false, params, explicit, false)
  const modes: CanonicalTool['modes'] = {}
  for (const [id, mode] of Object.entries(explicit ?? {})) {
    if (mode) setOwn(modes, id, mode)
  }
  return modes
}

/**
 * The entries of a tool's modes that inference over its params would not reach: the only modes
 * source has to write, since {@link toolModes} infers the rest.
 */
export function toolModeOverrides(
  catalog: BlockCatalog,
  tool: Pick<CanonicalTool, 'type' | 'params' | 'modes'>
): CanonicalTool['modes'] {
  const inferred = toolModes(catalog, tool.type, tool.params)
  const overrides: CanonicalTool['modes'] = {}
  for (const [id, mode] of Object.entries(tool.modes)) {
    if (getOwn(inferred, id) !== mode) setOwn(overrides, id, mode)
  }
  return overrides
}

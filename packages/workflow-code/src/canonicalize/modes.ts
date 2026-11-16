import {
  type CanonicalModeOverrides,
  isCanonicalPair,
  resolveCanonicalMode,
} from '../catalog/canonical-index'
import { buildCanonicalIndexForSurface } from '../catalog/surface'
import type { CatalogBlock } from '../catalog/types'
import type { CanonicalParamId, ParamMode } from '../model'

/**
 * The effective mode of every canonical pair on the block's surface (s1 canonicalize step 4, quirk
 * 2), as the serializer resolves it (serializer/index.ts:637-650): an explicit override wins;
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
  const index = buildCanonicalIndexForSurface(block, triggerMode)
  const modes: Record<CanonicalParamId, ParamMode> = {}
  for (const group of Object.values(index.groupsById)) {
    if (!isCanonicalPair(group)) continue
    const explicit = overrides?.[group.canonicalId] != null
    modes[group.canonicalId] =
      legacyAdvancedMode && !explicit ? 'advanced' : resolveCanonicalMode(group, values, overrides)
  }
  return modes
}

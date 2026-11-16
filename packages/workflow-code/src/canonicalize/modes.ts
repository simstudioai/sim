import {
  buildCanonicalIndex,
  type CanonicalIndexSubBlock,
  type CanonicalModeOverrides,
  isCanonicalPair,
  resolveCanonicalMode,
} from '../catalog/canonical-index'
import type { CanonicalParamId, ParamMode } from '../model'

/**
 * The effective mode of every canonical pair (s1 canonicalize step 4, quirk 2), as the
 * serializer resolves it (serializer/index.ts:637-650): an explicit override wins; otherwise the
 * legacy block-level `advancedMode` makes a pair advanced; otherwise the mode is inferred from
 * which member holds a value (`resolveCanonicalMode`).
 *
 * The index is unscoped, like the serializer's and the backfill's (subblock-migrations.ts:731):
 * both members of a pair always sit on one surface, so scoping cannot change which pairs exist.
 */
export function effectiveModes(
  subBlocks: readonly CanonicalIndexSubBlock[],
  values: Record<string, unknown>,
  overrides: CanonicalModeOverrides | undefined,
  legacyAdvancedMode: boolean
): Record<CanonicalParamId, ParamMode> {
  const index = buildCanonicalIndex(subBlocks)
  const modes: Record<CanonicalParamId, ParamMode> = {}
  for (const group of Object.values(index.groupsById)) {
    if (!isCanonicalPair(group)) continue
    const explicit = overrides?.[group.canonicalId] != null
    modes[group.canonicalId] =
      legacyAdvancedMode && !explicit ? 'advanced' : resolveCanonicalMode(group, values, overrides)
  }
  return modes
}

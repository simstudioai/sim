import {
  buildCanonicalIndex,
  type CanonicalIndex,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  getCanonicalValues,
  isCanonicalPair,
  resolveCanonicalMode,
  resolveDependencyValue,
  type SubBlockCondition,
  scopeCanonicalModesForTool,
} from '@/lib/workflows/subblocks/visibility'
import type { SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'

export {
  buildCanonicalIndex,
  type CanonicalIndex,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isCanonicalPair,
  resolveCanonicalMode,
  resolveDependencyValue,
  scopeCanonicalModesForTool,
  type SubBlockCondition,
}

export interface ToolParamContext {
  blockType: string
  subBlocks: BlockSubBlockConfig[]
  canonicalIndex: CanonicalIndex
  values: Record<string, unknown>
  /**
   * Canonical-id-keyed mode overrides (the tool-scoped `canonicalModes`) so the preview honors an
   * explicit basic/advanced toggle, matching execution. Omitted -> the value heuristic.
   */
  overrides?: CanonicalModeOverrides
}

/**
 * Build preview context values for selectors that need dependency resolution.
 * Resolves canonical values so selectors get the correct credential/dependency values.
 */
export function buildPreviewContextValues(
  params: Record<string, unknown>,
  context: ToolParamContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...params }

  for (const [canonicalId, group] of Object.entries(context.canonicalIndex.groupsById)) {
    if (isCanonicalPair(group)) {
      const mode = resolveCanonicalMode(group, context.values, context.overrides)
      const { basicValue, advancedValue } = getCanonicalValues(group, context.values)
      result[canonicalId] =
        mode === 'advanced' ? (advancedValue ?? basicValue) : (basicValue ?? advancedValue)
    }
  }

  return result
}

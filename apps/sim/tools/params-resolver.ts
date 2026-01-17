import {
  buildCanonicalIndex,
  type CanonicalIndex,
  evaluateSubBlockCondition,
  getCanonicalValues,
  isCanonicalPair,
  resolveCanonicalMode,
  type SubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import type { SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'

export {
  buildCanonicalIndex,
  type CanonicalIndex,
  evaluateSubBlockCondition,
  type SubBlockCondition,
}

export interface ToolParamContext {
  blockType: string
  subBlocks: BlockSubBlockConfig[]
  canonicalIndex: CanonicalIndex
  values: Record<string, unknown>
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
      const mode = resolveCanonicalMode(group, context.values)
      const { basicValue, advancedValue } = getCanonicalValues(group, context.values)
      result[canonicalId] =
        mode === 'advanced' ? (advancedValue ?? basicValue) : (basicValue ?? advancedValue)
    }
  }

  return result
}

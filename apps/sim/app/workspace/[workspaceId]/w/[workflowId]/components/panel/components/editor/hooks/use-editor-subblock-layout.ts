import { useCallback, useMemo } from 'react'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
  isSubBlockFeatureEnabled,
  isSubBlockVisibleForMode,
} from '@/lib/workflows/subblocks/visibility'
import type { BlockConfig, SubBlockConfig, SubBlockType } from '@/blocks/types'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Custom hook for computing subblock layout in the editor panel.
 * Determines which subblocks should be visible based on mode, conditions, and feature flags.
 *
 * @param config - The block configuration containing subblock definitions
 * @param blockId - The ID of the current block being edited
 * @param displayAdvancedMode - Whether advanced mode is enabled for this block
 * @param displayTriggerMode - Whether trigger mode is enabled for this block
 * @param activeWorkflowId - The active workflow ID
 * @param blockSubBlockValues - Current subblock values from the store
 * @param isDiffMode - Whether we're currently viewing a diff
 * @returns Object containing subBlocks array and stateToUse for stable key generation
 */
export function useEditorSubblockLayout(
  config: BlockConfig,
  blockId: string,
  displayAdvancedMode: boolean,
  displayTriggerMode: boolean,
  activeWorkflowId: string | null,
  blockSubBlockValues: Record<string, any>,
  isSnapshotView: boolean
) {
  const blockDataFromStore = useWorkflowStore(
    useCallback((state) => state.blocks?.[blockId]?.data, [blockId])
  )
  const { config: permissionConfig } = usePermissionConfig()

  return useMemo(() => {
    // Guard against missing config or block selection
    if (!config || !Array.isArray((config as any).subBlocks) || !blockId) {
      return { subBlocks: [] as SubBlockConfig[], stateToUse: {} }
    }

    const diffStore = useWorkflowDiffStore.getState()
    const workflowBlocks = useWorkflowStore.getState().blocks || {}

    const sourceBlocks = isSnapshotView
      ? (diffStore.baselineWorkflow?.blocks as Record<string, any>) || {}
      : workflowBlocks

    const mergedMap = isSnapshotView
      ? { [blockId]: structuredClone(sourceBlocks[blockId]) }
      : mergeSubblockState(sourceBlocks, activeWorkflowId || undefined, blockId)

    const mergedState = mergedMap ? mergedMap[blockId] : undefined
    const mergedSubBlocks = mergedState?.subBlocks || {}
    const blockData = isSnapshotView ? mergedState?.data || {} : blockDataFromStore || {}

    const stateToUse = Object.keys(mergedSubBlocks).reduce(
      (acc, key) => {
        const baselineValue = mergedSubBlocks[key]?.value ?? null
        const liveValue =
          blockSubBlockValues[key] !== undefined ? blockSubBlockValues[key] : baselineValue
        acc[key] = {
          value: isSnapshotView ? baselineValue : liveValue,
        }
        return acc
      },
      {} as Record<string, { value: unknown }>
    )

    if (!isSnapshotView) {
      Object.keys(blockSubBlockValues).forEach((key) => {
        if (!(key in stateToUse)) {
          stateToUse[key] = { value: blockSubBlockValues[key] }
        }
      })
    }

    // Filter visible blocks and those that meet their conditions
    const rawValues = Object.entries(stateToUse).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        acc[key] = entry?.value
        return acc
      },
      {}
    )

    const subBlocksForCanonical = displayTriggerMode
      ? (config.subBlocks || []).filter(
          (subBlock) =>
            subBlock.mode === 'trigger' || subBlock.type === ('trigger-config' as SubBlockType)
        )
      : config.subBlocks || []
    const canonicalIndex = buildCanonicalIndex(subBlocksForCanonical)
    const effectiveAdvanced = displayAdvancedMode
    const canonicalModeOverrides = blockData?.canonicalModes

    const visibleSubBlocks = (config.subBlocks || []).filter((block) => {
      if (block.hidden) return false

      // Hide skill-input subblock when skills are disabled via permissions
      if (block.type === 'skill-input' && permissionConfig.disableSkills) return false

      // Check required feature if specified - declarative feature gating
      if (!isSubBlockFeatureEnabled(block)) return false

      // Special handling for trigger-config type (legacy trigger configuration UI)
      if (block.type === ('trigger-config' as SubBlockType)) {
        const isPureTriggerBlock = config?.triggers?.enabled && config.category === 'triggers'
        return displayTriggerMode || isPureTriggerBlock
      }

      // Filter by mode if specified
      if (block.mode === 'trigger') {
        if (!displayTriggerMode) return false
      }

      // When in trigger mode, hide blocks that don't have mode: 'trigger'
      if (displayTriggerMode && block.mode !== 'trigger') {
        return false
      }

      if (
        !isSubBlockVisibleForMode(
          block,
          effectiveAdvanced,
          canonicalIndex,
          rawValues,
          canonicalModeOverrides
        )
      ) {
        return false
      }

      // If there's no condition, the block should be shown
      if (!block.condition) return true

      return evaluateSubBlockCondition(block.condition, rawValues)
    })

    return { subBlocks: visibleSubBlocks, stateToUse }
  }, [
    config.subBlocks,
    config.triggers,
    config.category,
    blockId,
    displayAdvancedMode,
    displayTriggerMode,
    blockSubBlockValues,
    activeWorkflowId,
    isSnapshotView,
    blockDataFromStore,
    permissionConfig.disableSkills,
  ])
}

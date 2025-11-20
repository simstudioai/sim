import { useMemo } from 'react'
import { getEnv, isTruthy } from '@/lib/env'
import type { BlockConfig, SubBlockConfig, SubBlockType } from '@/blocks/types'
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
  isDiffMode: boolean
) {
  return useMemo(() => {
    // Guard against missing config or block selection
    if (!config || !Array.isArray((config as any).subBlocks) || !blockId) {
      return { subBlocks: [] as SubBlockConfig[], stateToUse: {} }
    }

    // Get the appropriate state for conditional evaluation
    let stateToUse: Record<string, any> = {}

    // Get blocks based on whether we're in diff mode
    let blocks: Record<string, any>
    if (isDiffMode) {
      // In diff mode, get blocks from diff workflow
      const diffStore = useWorkflowDiffStore.getState()
      const diffWorkflow = diffStore.diffWorkflow
      blocks = (diffWorkflow as any)?.blocks || {}
    } else {
      // In normal mode, get blocks from workflow store
      blocks = useWorkflowStore.getState().blocks || {}
    }

    const mergedMap = mergeSubblockState(blocks, activeWorkflowId || undefined, blockId)
    const mergedState = mergedMap ? mergedMap[blockId] : undefined
    const mergedSubBlocks = mergedState?.subBlocks || {}

    // In diff mode, prioritize diff workflow values; in normal mode, prioritize live store values
    stateToUse = Object.keys(mergedSubBlocks).reduce(
      (acc, key) => {
        const value = isDiffMode
          ? (mergedSubBlocks[key]?.value ?? null)
          : blockSubBlockValues[key] !== undefined
            ? blockSubBlockValues[key]
            : (mergedSubBlocks[key]?.value ?? null)
        acc[key] = { value }
        return acc
      },
      {} as Record<string, { value: unknown }>
    )

    // Only add live store values if not in diff mode
    if (!isDiffMode) {
      Object.keys(blockSubBlockValues).forEach((key) => {
        if (!(key in stateToUse)) {
          stateToUse[key] = { value: blockSubBlockValues[key] }
        }
      })
    }

    // Filter visible blocks and those that meet their conditions
    const visibleSubBlocks = (config.subBlocks || []).filter((block) => {
      if (block.hidden) return false

      // Check required feature if specified - declarative feature gating
      if (block.requiresFeature && !isTruthy(getEnv(block.requiresFeature))) {
        return false
      }

      // Special handling for trigger-config type (legacy trigger configuration UI)
      if (block.type === ('trigger-config' as SubBlockType)) {
        const isPureTriggerBlock = config?.triggers?.enabled && config.category === 'triggers'
        return displayTriggerMode || isPureTriggerBlock
      }

      // Filter by mode if specified
      if (block.mode) {
        if (block.mode === 'basic' && displayAdvancedMode) return false
        if (block.mode === 'advanced' && !displayAdvancedMode) return false
        if (block.mode === 'trigger') {
          // Show trigger mode blocks only when in trigger mode
          if (!displayTriggerMode) return false
        }
      }

      // When in trigger mode, hide blocks that don't have mode: 'trigger'
      if (displayTriggerMode && block.mode !== 'trigger') {
        return false
      }

      // If there's no condition, the block should be shown
      if (!block.condition) return true

      // If condition is a function, call it to get the actual condition object
      const actualCondition =
        typeof block.condition === 'function' ? block.condition() : block.condition

      // Get the values of the fields this block depends on from the appropriate state
      const fieldValue = stateToUse[actualCondition.field]?.value
      const andFieldValue = actualCondition.and
        ? stateToUse[actualCondition.and.field]?.value
        : undefined

      // Check if the condition value is an array
      const isValueMatch = Array.isArray(actualCondition.value)
        ? fieldValue != null &&
          (actualCondition.not
            ? !actualCondition.value.includes(fieldValue as string | number | boolean)
            : actualCondition.value.includes(fieldValue as string | number | boolean))
        : actualCondition.not
          ? fieldValue !== actualCondition.value
          : fieldValue === actualCondition.value

      // Check both conditions if 'and' is present
      const isAndValueMatch =
        !actualCondition.and ||
        (Array.isArray(actualCondition.and.value)
          ? andFieldValue != null &&
            (actualCondition.and.not
              ? !actualCondition.and.value.includes(andFieldValue as string | number | boolean)
              : actualCondition.and.value.includes(andFieldValue as string | number | boolean))
          : actualCondition.and.not
            ? andFieldValue !== actualCondition.and.value
            : andFieldValue === actualCondition.and.value)

      return isValueMatch && isAndValueMatch
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
    isDiffMode,
  ])
}

import { useMemo } from 'react'
import { getEnv, isTruthy } from '@/lib/env'
import type { BlockConfig, SubBlockConfig, SubBlockType } from '@/blocks/types'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Custom hook for computing subblock layout rows
 *
 * @param config - The block configuration
 * @param blockId - The ID of the block
 * @param displayAdvancedMode - Whether advanced mode is enabled
 * @param displayTriggerMode - Whether trigger mode is enabled
 * @param isPreview - Whether the block is in preview mode
 * @param isDiffMode - Whether the workflow is in diff mode
 * @param previewSubBlockValues - SubBlock values in preview mode
 * @param currentBlock - Current block in diff mode
 * @param activeWorkflowId - The active workflow ID
 * @param blockSubBlockValues - Current subblock values
 * @returns Object containing rows array and stateToUse for stable key generation
 */
export function useSubblockLayout(
  config: BlockConfig,
  blockId: string,
  displayAdvancedMode: boolean,
  displayTriggerMode: boolean,
  isPreview: boolean,
  isDiffMode: boolean,
  previewSubBlockValues: Record<string, any> | undefined,
  currentBlock: any,
  activeWorkflowId: string | null,
  blockSubBlockValues: Record<string, any>
) {
  return useMemo(() => {
    const rows: SubBlockConfig[][] = []
    let currentRow: SubBlockConfig[] = []
    let currentRowWidth = 0

    // Get the appropriate state for conditional evaluation
    let stateToUse: Record<string, any> = {}

    if (isPreview && previewSubBlockValues) {
      stateToUse = previewSubBlockValues
    } else if (isDiffMode && currentBlock) {
      stateToUse = currentBlock.subBlocks || {}
    } else {
      const blocks = useWorkflowStore.getState().blocks
      const mergedState = mergeSubblockState(blocks, activeWorkflowId || undefined, blockId)[
        blockId
      ]
      stateToUse = mergedState?.subBlocks || {}
    }

    // Filter visible blocks and those that meet their conditions
    const visibleSubBlocks = config.subBlocks.filter((block) => {
      if (block.hidden) return false

      // Check required feature if specified - declarative feature gating
      if (block.requiresFeature && !isTruthy(getEnv(block.requiresFeature))) {
        return false
      }

      // Special handling for trigger mode
      if (block.type === ('trigger-config' as SubBlockType)) {
        const isPureTriggerBlock = config?.triggers?.enabled && config.category === 'triggers'
        return displayTriggerMode || isPureTriggerBlock
      }

      if (displayTriggerMode && block.type !== ('trigger-config' as SubBlockType)) {
        return false
      }

      // Filter by mode if specified
      if (block.mode) {
        if (block.mode === 'basic' && displayAdvancedMode) return false
        if (block.mode === 'advanced' && !displayAdvancedMode) return false
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

    visibleSubBlocks.forEach((block) => {
      const blockWidth = block.layout === 'half' ? 0.5 : 1
      if (currentRowWidth + blockWidth > 1) {
        if (currentRow.length > 0) {
          rows.push([...currentRow])
        }
        currentRow = [block]
        currentRowWidth = blockWidth
      } else {
        currentRow.push(block)
        currentRowWidth += blockWidth
      }
    })

    if (currentRow.length > 0) {
      rows.push(currentRow)
    }

    return { rows, stateToUse }
  }, [
    config.subBlocks,
    config.triggers,
    config.category,
    blockId,
    displayAdvancedMode,
    displayTriggerMode,
    isPreview,
    previewSubBlockValues,
    isDiffMode,
    currentBlock,
    blockSubBlockValues,
    activeWorkflowId,
  ])
}

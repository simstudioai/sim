import { initializeStores } from './persistence'
import { useWorkflowRegistry } from './registry/store'
import { useSubBlockStore } from './subblock/store'
import { mergeSubblockState } from './utils'
import { useWorkflowStore } from './workflow/store'
import { BlockState } from './workflow/types'

// Initialize all stores on load
if (typeof window !== 'undefined') {
  initializeStores()
}

/**
 * Get the complete workflow state with subblock values merged in
 */
export function getWorkflowWithValues(): Record<string, BlockState> {
  const workflowState = useWorkflowStore.getState()
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

  if (!activeWorkflowId) return {}

  return mergeSubblockState(workflowState.blocks, activeWorkflowId)
}

/**
 * Get a specific block with its subblock values merged in
 */
export function getBlockWithValues(blockId: string): BlockState | null {
  const workflowState = useWorkflowStore.getState()
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

  if (!activeWorkflowId || !workflowState.blocks[blockId]) return null

  const mergedBlocks = mergeSubblockState(workflowState.blocks, activeWorkflowId, blockId)
  return mergedBlocks[blockId] || null
}

// Export all stores for direct access
export { useWorkflowRegistry, useWorkflowStore, useSubBlockStore }

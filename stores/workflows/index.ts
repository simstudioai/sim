import { useWorkflowRegistry } from './registry/store'
import { useSubBlockStore } from './subblock/store'
import { mergeSubblockState } from './utils'
import { useWorkflowStore } from './workflow/store'
import { BlockState } from './workflow/types'

// Get a specific block with its subblock values merged in
export function getBlockWithValues(blockId: string): BlockState | null {
  const workflowState = useWorkflowStore.getState()
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

  if (!activeWorkflowId || !workflowState.blocks[blockId]) return null

  const mergedBlocks = mergeSubblockState(workflowState.blocks, activeWorkflowId, blockId)
  return mergedBlocks[blockId] || null
}

// Get all workflows with their values merged
export function getAllWorkflowsWithValues() {
  const { workflows } = useWorkflowRegistry.getState()
  const result: Record<string, any> = {}

  for (const [id, metadata] of Object.entries(workflows)) {
    const state = useWorkflowStore.getState()
    const mergedBlocks = mergeSubblockState(state.blocks, id)

    result[id] = {
      id,
      name: metadata.name,
      description: metadata.description,
      color: metadata.color || '#3972F6',
      state: {
        blocks: mergedBlocks,
        edges: state.edges,
        loops: state.loops,
        lastSaved: state.lastSaved,
        isDeployed: state.isDeployed,
        deployedAt: state.deployedAt,
      },
    }
  }

  return result
}

export { useWorkflowRegistry, useWorkflowStore, useSubBlockStore }

import { createLogger } from '@/lib/logs/console-logger'
import { loadWorkflowState } from './persistence'
import { useWorkflowRegistry } from './registry/store'
import { useSubBlockStore } from './subblock/store'
import { mergeSubblockState } from './utils'
import { useWorkflowStore } from './workflow/store'
import { BlockState, WorkflowState } from './workflow/types'

const logger = createLogger('Workflows')

// Get a workflow with its state merged in by ID
export function getWorkflowWithValues(workflowId: string) {
  const { workflows } = useWorkflowRegistry.getState()
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  const currentState = useWorkflowStore.getState()

  if (!workflows[workflowId]) {
    logger.warn(`Workflow ${workflowId} not found`)
    return null
  }

  const metadata = workflows[workflowId]

  // Load the specific state for this workflow
  let workflowState: WorkflowState

  if (workflowId === activeWorkflowId) {
    // For the active workflow, use the current state from the store
    workflowState = {
      blocks: currentState.blocks,
      edges: currentState.edges,
      loops: currentState.loops,
      isDeployed: currentState.isDeployed,
      deployedAt: currentState.deployedAt,
      lastSaved: currentState.lastSaved,
    }
  } else {
    // For other workflows, load their state from localStorage
    const savedState = loadWorkflowState(workflowId)
    if (!savedState) {
      logger.warn(`No saved state found for workflow ${workflowId}`)
      return null
    }
    workflowState = savedState
  }

  // Merge the subblock values for this specific workflow
  const mergedBlocks = mergeSubblockState(workflowState.blocks, workflowId)

  return {
    id: workflowId,
    name: metadata.name,
    description: metadata.description,
    color: metadata.color || '#3972F6',
    marketplaceData: metadata.marketplaceData || null,
    state: {
      blocks: mergedBlocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      lastSaved: workflowState.lastSaved,
      isDeployed: workflowState.isDeployed,
      deployedAt: workflowState.deployedAt,
    },
  }
}

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
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  const currentState = useWorkflowStore.getState()

  for (const [id, metadata] of Object.entries(workflows)) {
    // Load the specific state for this workflow
    let workflowState: WorkflowState

    if (id === activeWorkflowId) {
      // For the active workflow, use the current state from the store
      workflowState = {
        blocks: currentState.blocks,
        edges: currentState.edges,
        loops: currentState.loops,
        isDeployed: currentState.isDeployed,
        deployedAt: currentState.deployedAt,
        lastSaved: currentState.lastSaved,
      }
    } else {
      // For other workflows, load their state from localStorage
      const savedState = loadWorkflowState(id)
      if (!savedState) {
        // Skip workflows with no saved state
        logger.warn(`No saved state found for workflow ${id}`)
        continue
      }
      workflowState = savedState
    }

    // Merge the subblock values for this specific workflow
    const mergedBlocks = mergeSubblockState(workflowState.blocks, id)

    result[id] = {
      id,
      name: metadata.name,
      description: metadata.description,
      color: metadata.color || '#3972F6',
      marketplaceData: metadata.marketplaceData || null,
      state: {
        blocks: mergedBlocks,
        edges: workflowState.edges,
        loops: workflowState.loops,
        lastSaved: workflowState.lastSaved,
        isDeployed: workflowState.isDeployed,
        deployedAt: workflowState.deployedAt,
      },
    }
  }

  return result
}

export { useWorkflowRegistry, useWorkflowStore, useSubBlockStore }

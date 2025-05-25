import { createLogger } from '@/lib/logs/console-logger'
import { loadWorkflowState } from './persistence'
import { useWorkflowRegistry } from './registry/store'
import { useSubBlockStore } from './subblock/store'
import { mergeSubblockState } from './utils'
import { useWorkflowStore } from './workflow/store'
import type { BlockState, WorkflowState } from './workflow/types'

const logger = createLogger('Workflows')

/**
 * Get a workflow with its state merged in by ID
 * @param workflowId ID of the workflow to retrieve
 * @returns The workflow with merged state values or null if not found
 */
export function getWorkflowWithValues(workflowId: string) {
  const { workflows } = useWorkflowRegistry.getState()
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  const currentState = useWorkflowStore.getState()

  if (!workflows[workflowId]) {
    logger.warn(`Workflow ${workflowId} not found`)
    return null
  }

  const metadata = workflows[workflowId]

  // Get deployment status from registry
  const deploymentStatus = useWorkflowRegistry.getState().getWorkflowDeploymentStatus(workflowId)

  // Load the specific state for this workflow
  let workflowState: WorkflowState

  if (workflowId === activeWorkflowId) {
    // For the active workflow, use the current state from the store
    workflowState = {
      blocks: currentState.blocks,
      edges: currentState.edges,
      loops: currentState.loops,
      parallels: currentState.parallels,
      isDeployed: deploymentStatus?.isDeployed || false,
      deployedAt: deploymentStatus?.deployedAt,
      lastSaved: currentState.lastSaved,
    }
  } else {
    // For other workflows, load their state from localStorage
    const savedState = loadWorkflowState(workflowId)
    if (!savedState) {
      logger.warn(`No saved state found for workflow ${workflowId}`)
      return null
    }

    // Use registry deployment status instead of relying on saved state
    workflowState = {
      ...savedState,
      isDeployed: deploymentStatus?.isDeployed || savedState.isDeployed || false,
      deployedAt: deploymentStatus?.deployedAt || savedState.deployedAt,
    }
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
      parallels: workflowState.parallels,
      lastSaved: workflowState.lastSaved,
      isDeployed: workflowState.isDeployed,
      deployedAt: workflowState.deployedAt,
    },
  }
}

/**
 * Get a specific block with its subblock values merged in
 * @param blockId ID of the block to retrieve
 * @returns The block with merged subblock values or null if not found
 */
export function getBlockWithValues(blockId: string): BlockState | null {
  const workflowState = useWorkflowStore.getState()
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

  if (!activeWorkflowId || !workflowState.blocks[blockId]) return null

  const mergedBlocks = mergeSubblockState(workflowState.blocks, activeWorkflowId, blockId)
  return mergedBlocks[blockId] || null
}

/**
 * Get all workflows with their values merged
 * Used for sync operations to prepare the payload
 * @returns An object containing all workflows with their merged state values
 */
export function getAllWorkflowsWithValues() {
  const { workflows, activeWorkspaceId } = useWorkflowRegistry.getState()
  const result: Record<string, any> = {}
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  const currentState = useWorkflowStore.getState()

  for (const [id, metadata] of Object.entries(workflows)) {
    // Skip workflows that don't belong to the active workspace
    if (activeWorkspaceId && metadata.workspaceId !== activeWorkspaceId) {
      logger.debug(
        `Skipping workflow ${id} - belongs to workspace ${metadata.workspaceId}, not active workspace ${activeWorkspaceId}`
      )
      continue
    }

    // Get deployment status from registry
    const deploymentStatus = useWorkflowRegistry.getState().getWorkflowDeploymentStatus(id)

    // Load the specific state for this workflow
    let workflowState: WorkflowState

    if (id === activeWorkflowId) {
      // For the active workflow, use the current state from the store
      workflowState = {
        blocks: currentState.blocks,
        edges: currentState.edges,
        loops: currentState.loops,
        parallels: currentState.parallels,
        isDeployed: deploymentStatus?.isDeployed || false,
        deployedAt: deploymentStatus?.deployedAt,
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

      // Use registry deployment status instead of relying on saved state
      workflowState = {
        ...savedState,
        isDeployed: deploymentStatus?.isDeployed || savedState.isDeployed || false,
        deployedAt: deploymentStatus?.deployedAt || savedState.deployedAt,
      }
    }

    // Merge the subblock values for this specific workflow
    const mergedBlocks = mergeSubblockState(workflowState.blocks, id)

    // Include the API key in the state if it exists in the deployment status
    const apiKey = deploymentStatus?.apiKey

    result[id] = {
      id,
      name: metadata.name,
      description: metadata.description,
      color: metadata.color || '#3972F6',
      marketplaceData: metadata.marketplaceData || null,
      workspaceId: metadata.workspaceId, // Include workspaceId in the result
      state: {
        blocks: mergedBlocks,
        edges: workflowState.edges,
        loops: workflowState.loops,
        parallels: workflowState.parallels,
        lastSaved: workflowState.lastSaved,
        isDeployed: workflowState.isDeployed,
        deployedAt: workflowState.deployedAt,
      },
      // Include API key if available
      apiKey,
    }
  }

  return result
}

/**
 * Convenience function to mark workflows as dirty and initiate a sync
 * This is a shortcut for other files to trigger sync operations
 */
export function syncWorkflows() {
  const workflowStore = useWorkflowStore.getState()
  workflowStore.sync.markDirty()
  workflowStore.sync.forceSync()
}

export { useWorkflowRegistry, useWorkflowStore, useSubBlockStore }

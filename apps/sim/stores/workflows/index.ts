import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('Workflows')

/**
 * Get a workflow with its state merged in by ID
 * Note: Since localStorage has been removed, this only works for the active workflow
 * @param workflowId ID of the workflow to retrieve
 * @returns The workflow with merged state values or null if not found/not active
 */
export function getWorkflowWithValues(workflowId: string) {
  const { workflows } = useWorkflowRegistry.getState()
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  const currentState = useWorkflowStore.getState()

  if (!workflows[workflowId]) {
    logger.warn(`Workflow ${workflowId} not found`)
    return null
  }

  // Since localStorage persistence has been removed, only return data for active workflow
  if (workflowId !== activeWorkflowId) {
    logger.warn(`Cannot get state for non-active workflow ${workflowId} - localStorage removed`)
    return null
  }

  const metadata = workflows[workflowId]

  // Get deployment status from registry
  const deploymentStatus = useWorkflowRegistry.getState().getWorkflowDeploymentStatus(workflowId)

  // Use the current state from the store (only available for active workflow)
  const workflowState: WorkflowState = {
    blocks: currentState.blocks,
    edges: currentState.edges,
    loops: currentState.loops,
    parallels: currentState.parallels,
    isDeployed: deploymentStatus?.isDeployed || false,
    deployedAt: deploymentStatus?.deployedAt,
    lastSaved: currentState.lastSaved,
  }

  // Merge the subblock values for this specific workflow
  const mergedBlocks = mergeSubblockState(workflowState.blocks, workflowId)

  return {
    id: workflowId,
    name: metadata.name,
    description: metadata.description,
    color: metadata.color || '#3972F6',
    marketplaceData: metadata.marketplaceData || null,
    workspaceId: metadata.workspaceId,
    folderId: metadata.folderId,
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
 * Note: Since localStorage has been removed, this only includes the active workflow state
 * @returns An object containing workflows, with state only for the active workflow
 */
export function getAllWorkflowsWithValues() {
  const { workflows } = useWorkflowRegistry.getState()
  const result: Record<string, any> = {}
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  const currentState = useWorkflowStore.getState()

  // Only sync the active workflow to ensure we always send valid state data
  if (activeWorkflowId && workflows[activeWorkflowId]) {
    const metadata = workflows[activeWorkflowId]

    // Get deployment status from registry
    const deploymentStatus = useWorkflowRegistry
      .getState()
      .getWorkflowDeploymentStatus(activeWorkflowId)

    // Ensure state has all required fields for Zod validation
    const workflowState: WorkflowState = {
      blocks: currentState.blocks || {},
      edges: currentState.edges || [],
      loops: currentState.loops || {},
      parallels: currentState.parallels || {},
      isDeployed: deploymentStatus?.isDeployed || false,
      deployedAt: deploymentStatus?.deployedAt,
      lastSaved: currentState.lastSaved || Date.now(),
    }

    // Merge the subblock values for this specific workflow
    const mergedBlocks = mergeSubblockState(workflowState.blocks, activeWorkflowId)

    // Include the API key in the state if it exists in the deployment status
    const apiKey = deploymentStatus?.apiKey

    result[activeWorkflowId] = {
      id: activeWorkflowId,
      name: metadata.name,
      description: metadata.description,
      color: metadata.color || '#3972F6',
      marketplaceData: metadata.marketplaceData || null,
      folderId: metadata.folderId,
      state: {
        blocks: mergedBlocks,
        edges: workflowState.edges,
        loops: workflowState.loops,
        parallels: workflowState.parallels,
        lastSaved: workflowState.lastSaved,
        isDeployed: workflowState.isDeployed,
        deployedAt: workflowState.deployedAt,
        marketplaceData: metadata.marketplaceData || null,
      },
      // Include API key if available
      apiKey,
    }

    // Only include workspaceId if it's not null/undefined
    if (metadata.workspaceId) {
      result[activeWorkflowId].workspaceId = metadata.workspaceId
    }
  }

  return result
}

export { useWorkflowRegistry } from '@/stores/workflows/registry/store'
export type { WorkflowMetadata } from '@/stores/workflows/registry/types'
export { useSubBlockStore } from '@/stores/workflows/subblock/store'
export type { SubBlockStore } from '@/stores/workflows/subblock/types'
export { mergeSubblockState } from '@/stores/workflows/utils'
export { useWorkflowStore } from '@/stores/workflows/workflow/store'
export type { WorkflowState } from '@/stores/workflows/workflow/types'

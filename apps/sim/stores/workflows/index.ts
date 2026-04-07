import { createLogger } from '@sim/logger'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('Workflows')

/**
 * Get a workflow with its state merged in by ID
 * Note: Since localStorage has been removed, this only works for the active workflow
 * @param workflowId ID of the workflow to retrieve
 * @param workspaceId Workspace containing the workflow metadata
 * @returns The workflow with merged state values or null if not found/not active
 */
export function getWorkflowWithValues(workflowId: string, workspaceId: string) {
  const workflows = getWorkflows(workspaceId)
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

  const metadata = workflows.find((w) => w.id === workflowId)
  if (!metadata) {
    logger.warn(`Workflow ${workflowId} not found`)
    return null
  }

  // Since localStorage persistence has been removed, only return data for active workflow
  if (workflowId !== activeWorkflowId) {
    logger.warn(`Cannot get state for non-active workflow ${workflowId} - localStorage removed`)
    return null
  }

  // Use the current state from the store (only available for active workflow)
  const workflowState: WorkflowState = useWorkflowStore.getState().getWorkflowState()

  // Merge the subblock values for this specific workflow
  const mergedBlocks = mergeSubblockState(workflowState.blocks, workflowId)

  return {
    id: workflowId,
    name: metadata.name,
    description: metadata.description,
    color: metadata.color || '#3972F6',
    workspaceId: metadata.workspaceId,
    folderId: metadata.folderId,
    state: {
      blocks: mergedBlocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      parallels: workflowState.parallels,
      lastSaved: workflowState.lastSaved,
    },
  }
}

export { useWorkflowRegistry } from '@/stores/workflows/registry/store'
export type { WorkflowMetadata } from '@/stores/workflows/registry/types'
export { useSubBlockStore } from '@/stores/workflows/subblock/store'
export type { SubBlockStore } from '@/stores/workflows/subblock/types'
export { mergeSubblockState } from '@/stores/workflows/utils'
export { useWorkflowStore } from '@/stores/workflows/workflow/store'
export type { WorkflowState } from '@/stores/workflows/workflow/types'

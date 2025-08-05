import { useMemo } from 'react'
import type { Edge } from 'reactflow'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import type { DeploymentStatus } from '@/stores/workflows/registry/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Interface for the current workflow abstraction
 */
export interface CurrentWorkflow {
  // Current workflow state properties
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastSaved?: number
  isDeployed?: boolean
  deployedAt?: Date
  deploymentStatuses?: Record<string, DeploymentStatus>
  needsRedeployment?: boolean
  hasActiveWebhook?: boolean

  // Mode information
  isDiffMode: boolean
  isNormalMode: boolean

  // Full workflow state (for cases that need the complete object)
  workflowState: WorkflowState

  // Helper methods
  getBlockById: (blockId: string) => BlockState | undefined
  getBlockCount: () => number
  getEdgeCount: () => number
  hasBlocks: () => boolean
  hasEdges: () => boolean
}

/**
 * Clean abstraction for accessing the current workflow state.
 * Automatically handles diff vs normal mode without exposing the complexity to consumers.
 */
export function useCurrentWorkflow(): CurrentWorkflow {
  // Get normal workflow state
  const normalWorkflow = useWorkflowStore((state) => state.getWorkflowState())

  // Get diff state - now including isDiffReady
  const { isShowingDiff, isDiffReady, diffWorkflow } = useWorkflowDiffStore()

  // Create the abstracted interface
  const currentWorkflow = useMemo((): CurrentWorkflow => {
    // Determine which workflow to use - only use diff if it's ready
    const shouldUseDiff = isShowingDiff && isDiffReady && !!diffWorkflow
    const activeWorkflow = shouldUseDiff ? diffWorkflow : normalWorkflow

    return {
      // Current workflow state
      blocks: activeWorkflow.blocks,
      edges: activeWorkflow.edges,
      loops: activeWorkflow.loops || {},
      parallels: activeWorkflow.parallels || {},
      lastSaved: activeWorkflow.lastSaved,
      isDeployed: activeWorkflow.isDeployed,
      deployedAt: activeWorkflow.deployedAt,
      deploymentStatuses: activeWorkflow.deploymentStatuses,
      needsRedeployment: activeWorkflow.needsRedeployment,
      hasActiveWebhook: activeWorkflow.hasActiveWebhook,

      // Mode information - update to reflect ready state
      isDiffMode: shouldUseDiff,
      isNormalMode: !shouldUseDiff,

      // Full workflow state (for cases that need the complete object)
      workflowState: activeWorkflow,

      // Helper methods
      getBlockById: (blockId: string) => activeWorkflow.blocks[blockId],
      getBlockCount: () => Object.keys(activeWorkflow.blocks).length,
      getEdgeCount: () => activeWorkflow.edges.length,
      hasBlocks: () => Object.keys(activeWorkflow.blocks).length > 0,
      hasEdges: () => activeWorkflow.edges.length > 0,
    }
  }, [normalWorkflow, isShowingDiff, isDiffReady, diffWorkflow])

  return currentWorkflow
}

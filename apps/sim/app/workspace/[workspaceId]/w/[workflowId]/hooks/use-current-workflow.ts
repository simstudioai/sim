import { useMemo } from 'react'
import type { Edge } from 'reactflow'
import { shallow } from 'zustand/shallow'
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
  // Get normal workflow state - optimized with shallow comparison
  // This prevents re-renders when only subblock values change (not block structure)
  const normalWorkflow = useWorkflowStore((state) => {
    const workflow = state.getWorkflowState()
    return {
      blocks: workflow.blocks,
      edges: workflow.edges,
      loops: workflow.loops,
      parallels: workflow.parallels,
      lastSaved: workflow.lastSaved,
      isDeployed: workflow.isDeployed,
      deployedAt: workflow.deployedAt,
      deploymentStatuses: workflow.deploymentStatuses,
      needsRedeployment: workflow.needsRedeployment,
    }
  }, shallow)

  // Get diff state - now including isDiffReady
  const { isShowingDiff, isDiffReady, diffWorkflow } = useWorkflowDiffStore()

  // Create the abstracted interface - optimized to prevent unnecessary re-renders
  const currentWorkflow = useMemo((): CurrentWorkflow => {
    // Determine which workflow to use - only use diff if it's ready
    const hasDiffBlocks =
      !!diffWorkflow && Object.keys((diffWorkflow as any).blocks || {}).length > 0
    const shouldUseDiff = isShowingDiff && isDiffReady && hasDiffBlocks
    const activeWorkflow = shouldUseDiff ? diffWorkflow : normalWorkflow

    return {
      // Current workflow state
      blocks: activeWorkflow.blocks || {},
      edges: activeWorkflow.edges || [],
      loops: activeWorkflow.loops || {},
      parallels: activeWorkflow.parallels || {},
      lastSaved: activeWorkflow.lastSaved,
      isDeployed: activeWorkflow.isDeployed,
      deployedAt: activeWorkflow.deployedAt,
      deploymentStatuses: activeWorkflow.deploymentStatuses,
      needsRedeployment: activeWorkflow.needsRedeployment,

      // Mode information - update to reflect ready state
      isDiffMode: shouldUseDiff,
      isNormalMode: !shouldUseDiff,

      // Full workflow state (for cases that need the complete object)
      workflowState: activeWorkflow as WorkflowState,

      // Helper methods
      getBlockById: (blockId: string) => activeWorkflow.blocks?.[blockId],
      getBlockCount: () => Object.keys(activeWorkflow.blocks || {}).length,
      getEdgeCount: () => (activeWorkflow.edges || []).length,
      hasBlocks: () => Object.keys(activeWorkflow.blocks || {}).length > 0,
      hasEdges: () => (activeWorkflow.edges || []).length > 0,
    }
  }, [normalWorkflow, isShowingDiff, isDiffReady, diffWorkflow])

  return currentWorkflow
}

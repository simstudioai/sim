import { useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
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
 */
export function useCurrentWorkflow(): CurrentWorkflow {
  const activeWorkflow = useWorkflowStore(
    useShallow((state) => ({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops,
      parallels: state.parallels,
      lastSaved: state.lastSaved,
    }))
  )

  return useMemo(
    (): CurrentWorkflow => ({
      blocks: activeWorkflow.blocks || {},
      edges: activeWorkflow.edges || [],
      loops: activeWorkflow.loops || {},
      parallels: activeWorkflow.parallels || {},
      lastSaved: activeWorkflow.lastSaved,

      workflowState: activeWorkflow as WorkflowState,

      getBlockById: (blockId: string) => activeWorkflow.blocks?.[blockId],
      getBlockCount: () => Object.keys(activeWorkflow.blocks || {}).length,
      getEdgeCount: () => (activeWorkflow.edges || []).length,
      hasBlocks: () => Object.keys(activeWorkflow.blocks || {}).length > 0,
      hasEdges: () => (activeWorkflow.edges || []).length > 0,
    }),
    [activeWorkflow]
  )
}

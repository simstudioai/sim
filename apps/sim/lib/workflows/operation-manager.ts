import type { Edge } from 'reactflow'
import type { Position } from '@/stores/workflows/workflow/types'

/**
 * Abstract interface for workflow operations
 * Provides a unified API regardless of whether collaboration is enabled
 */
export interface WorkflowOperationManager {
  // Block operations
  addBlock: (
    id: string,
    type: string,
    name: string,
    position: Position,
    data?: Record<string, any>,
    parentId?: string,
    extent?: 'parent'
  ) => void

  updateBlockPosition: (id: string, position: Position) => void
  updateBlockName: (id: string, name: string) => void
  removeBlock: (id: string) => void
  toggleBlockEnabled: (id: string) => void
  updateParentId: (id: string, parentId: string, extent: 'parent') => void

  // Edge operations
  addEdge: (edge: Edge) => void
  removeEdge: (edgeId: string) => void

  // Subblock operations
  setSubblockValue: (blockId: string, subblockId: string, value: any) => void

  // Loop/parallel operations
  updateLoopCount: (loopId: string, count: number) => void
  updateLoopType: (loopId: string, type: string) => void
  updateLoopCollection: (loopId: string, collection: string) => void
  updateParallelCount: (parallelId: string, count: number) => void
  updateParallelCollection: (parallelId: string, collection: string) => void

  // State management
  isDirty?: () => boolean
  save?: () => Promise<void>
  isConnected?: boolean
  currentWorkflowId?: string | null

  // Cleanup
  destroy?: () => void
}

/**
 * Operation payload types for consistency
 */
export interface BlockOperationPayload {
  id: string
  type?: string
  name?: string
  position?: Position
  data?: Record<string, any>
  parentId?: string
  extent?: 'parent'
}

export interface EdgeOperationPayload {
  edge?: Edge
  edgeId?: string
}

export interface SubblockOperationPayload {
  blockId: string
  subblockId: string
  value: any
}

export interface LoopOperationPayload {
  loopId: string
  count?: number
  type?: string
  collection?: string
}

export interface ParallelOperationPayload {
  parallelId: string
  count?: number
  type?: string
  collection?: string
}

/**
 * Factory function to create the appropriate workflow operation manager
 */
export function createWorkflowOperationManager(
  workflowId: string,
  isCollaborationEnabled: boolean,
  collaborativeHook?: any
): WorkflowOperationManager {
  if (isCollaborationEnabled && collaborativeHook) {
    const { CollaborativeWorkflowOperations } = require('./collaborative-operations')
    return new CollaborativeWorkflowOperations(collaborativeHook)
  }
  const { LocalWorkflowOperations } = require('./local-operations')
  return new LocalWorkflowOperations(workflowId)
}

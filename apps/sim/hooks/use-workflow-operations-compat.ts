import { useSocket } from '@/contexts/socket-context'
import { useWorkflowOperationsSafe } from '@/contexts/workflow-operation-context'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'

/**
 * Compatibility hook that provides workflow operations in the same interface
 * as the original collaborative workflow hook, but works with both collaborative
 * and non-collaborative modes
 */
export function useWorkflowOperationsCompat() {
  const { operationManager, isCollaborative, isReady } = useWorkflowOperationsSafe()
  const { emitSubblockUpdate } = useSocket()
  const collaborativeHook = useCollaborativeWorkflow()

  // If operations aren't ready, return empty functions to prevent errors
  if (!isReady || !operationManager) {
    return {
      // Block operations
      collaborativeAddBlock: () => {},
      collaborativeAddEdge: () => {},
      collaborativeRemoveEdge: () => {},
      collaborativeRemoveBlock: () => {},
      collaborativeUpdateBlockPosition: () => {},
      collaborativeUpdateParentId: () => {},
      collaborativeSetSubblockValue: () => {},

      // Loop/parallel operations
      collaborativeUpdateLoopCount: () => {},
      collaborativeUpdateLoopType: () => {},
      collaborativeUpdateLoopCollection: () => {},
      collaborativeUpdateParallelCount: () => {},
      collaborativeUpdateParallelCollection: () => {},

      // Connection status
      isConnected: false,
      currentWorkflowId: null,
      presenceUsers: [],
      joinWorkflow: () => {},

      // Emit functions (for backward compatibility)
      emitSubblockUpdate: () => {},
    }
  }

  // For collaborative mode, return the original collaborative hook
  if (isCollaborative) {
    return {
      collaborativeAddBlock: collaborativeHook.collaborativeAddBlock,
      collaborativeAddEdge: collaborativeHook.collaborativeAddEdge,
      collaborativeRemoveEdge: collaborativeHook.collaborativeRemoveEdge,
      collaborativeRemoveBlock: collaborativeHook.collaborativeRemoveBlock,
      collaborativeUpdateBlockPosition: collaborativeHook.collaborativeUpdateBlockPosition,
      collaborativeUpdateParentId: collaborativeHook.collaborativeUpdateParentId,
      collaborativeSetSubblockValue: collaborativeHook.collaborativeSetSubblockValue,

      // Loop/parallel operations
      collaborativeUpdateLoopCount: collaborativeHook.collaborativeUpdateLoopCount,
      collaborativeUpdateLoopType: collaborativeHook.collaborativeUpdateLoopType,
      collaborativeUpdateLoopCollection: collaborativeHook.collaborativeUpdateLoopCollection,
      collaborativeUpdateParallelCount: collaborativeHook.collaborativeUpdateParallelCount,
      collaborativeUpdateParallelCollection:
        collaborativeHook.collaborativeUpdateParallelCollection,

      isConnected: collaborativeHook.isConnected,
      currentWorkflowId: collaborativeHook.currentWorkflowId,
      presenceUsers: collaborativeHook.presenceUsers,
      joinWorkflow: collaborativeHook.joinWorkflow,
      emitSubblockUpdate,
    }
  }

  // For non-collaborative mode, wrap the operation manager
  return {
    // Block operations
    collaborativeAddBlock: operationManager.addBlock,
    collaborativeAddEdge: operationManager.addEdge,
    collaborativeRemoveEdge: operationManager.removeEdge,
    collaborativeRemoveBlock: operationManager.removeBlock,
    collaborativeUpdateBlockPosition: operationManager.updateBlockPosition,
    collaborativeUpdateParentId: operationManager.updateParentId,
    collaborativeSetSubblockValue: operationManager.setSubblockValue,

    // Loop/parallel operations
    collaborativeUpdateLoopCount: operationManager.updateLoopCount,
    collaborativeUpdateLoopType: operationManager.updateLoopType,
    collaborativeUpdateLoopCollection: operationManager.updateLoopCollection,
    collaborativeUpdateParallelCount: operationManager.updateParallelCount,
    collaborativeUpdateParallelCollection: operationManager.updateParallelCollection,

    // Connection status - always connected in local mode
    isConnected: true,
    currentWorkflowId: operationManager.currentWorkflowId,
    presenceUsers: [], // Empty array for local mode
    joinWorkflow: () => {}, // No-op in local mode

    // Emit functions - use operation manager for local mode
    emitSubblockUpdate: operationManager.setSubblockValue,
  }
}

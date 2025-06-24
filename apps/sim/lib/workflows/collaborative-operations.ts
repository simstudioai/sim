import type { Edge } from 'reactflow'
import type { Position } from '@/stores/workflows/workflow/types'
import type { WorkflowOperationManager } from './operation-manager'

/**
 * Collaborative workflow operations using Socket.IO
 * This wraps the existing collaborative workflow hook functionality
 */
export class CollaborativeWorkflowOperations implements WorkflowOperationManager {
  private collaborativeHook: any

  constructor(collaborativeHook: any) {
    this.collaborativeHook = collaborativeHook
  }

  // Block operations
  addBlock = (
    id: string,
    type: string,
    name: string,
    position: Position,
    data?: Record<string, any>,
    parentId?: string,
    extent?: 'parent'
  ) => {
    this.collaborativeHook.collaborativeAddBlock(id, type, name, position, data, parentId, extent)
  }

  updateBlockPosition = (id: string, position: Position) => {
    this.collaborativeHook.collaborativeUpdateBlockPosition(id, position)
  }

  updateBlockName = (id: string, name: string) => {
    this.collaborativeHook.collaborativeUpdateBlockName(id, name)
  }

  removeBlock = (id: string) => {
    this.collaborativeHook.collaborativeRemoveBlock(id)
  }

  toggleBlockEnabled = (id: string) => {
    this.collaborativeHook.collaborativeToggleBlockEnabled(id)
  }

  updateParentId = (id: string, parentId: string, extent: 'parent') => {
    this.collaborativeHook.collaborativeUpdateParentId(id, parentId, extent)
  }

  // Edge operations
  addEdge = (edge: Edge) => {
    this.collaborativeHook.collaborativeAddEdge(edge)
  }

  removeEdge = (edgeId: string) => {
    this.collaborativeHook.collaborativeRemoveEdge(edgeId)
  }

  // Subblock operations
  setSubblockValue = (blockId: string, subblockId: string, value: any) => {
    this.collaborativeHook.collaborativeSetSubblockValue(blockId, subblockId, value)
  }

  // Loop/parallel operations
  updateLoopCount = (loopId: string, count: number) => {
    this.collaborativeHook.collaborativeUpdateLoopCount(loopId, count)
  }

  updateLoopType = (loopId: string, type: string) => {
    this.collaborativeHook.collaborativeUpdateLoopType(loopId, type)
  }

  updateLoopCollection = (loopId: string, collection: string) => {
    this.collaborativeHook.collaborativeUpdateLoopCollection(loopId, collection)
  }

  updateParallelCount = (parallelId: string, count: number) => {
    this.collaborativeHook.collaborativeUpdateParallelCount(parallelId, count)
  }

  updateParallelCollection = (parallelId: string, collection: string) => {
    this.collaborativeHook.collaborativeUpdateParallelCollection(parallelId, collection)
  }



  // State management - collaborative mode doesn't need manual save
  isDirty = () => false // Always clean in collaborative mode
  save = async () => {} // No-op in collaborative mode

  // Connection status
  get isConnected() {
    return this.collaborativeHook.isConnected
  }

  get currentWorkflowId() {
    return this.collaborativeHook.currentWorkflowId
  }
}

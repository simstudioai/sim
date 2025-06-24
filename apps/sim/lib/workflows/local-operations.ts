import type { Edge } from 'reactflow'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { Position } from '@/stores/workflows/workflow/types'
import type { WorkflowOperationManager } from './operation-manager'

const logger = createLogger('LocalWorkflowOperations')

/**
 * Local workflow operations with manual save functionality
 * Tracks dirty state and provides save button functionality
 */
export class LocalWorkflowOperations implements WorkflowOperationManager {
  private workflowId: string
  private dirtyState = new Set<string>()
  private saveCallbacks: Array<() => void> = []
  private subblockEventListener: ((event: CustomEvent) => void) | null = null

  constructor(workflowId: string) {
    this.workflowId = workflowId
    this.setupSubblockEventListener()
  }

  private setupSubblockEventListener = () => {
    // Listen for subblock updates from the custom event system
    this.subblockEventListener = (event: CustomEvent) => {
      const { blockId, subBlockId, value } = event.detail
      if (blockId && subBlockId) {
        logger.info(`Subblock update detected: ${blockId}.${subBlockId}`)
        this.markDirty(`subblock-${blockId}-${subBlockId}`)
      }
    }

    window.addEventListener('update-subblock-value', this.subblockEventListener as EventListener)
  }

  // Cleanup method to remove event listener
  destroy = () => {
    if (this.subblockEventListener) {
      window.removeEventListener(
        'update-subblock-value',
        this.subblockEventListener as EventListener
      )
      this.subblockEventListener = null
    }
  }

  private markDirty = (operation: string) => {
    this.dirtyState.add(operation)
    this.notifyDirtyStateChange()
  }

  private notifyDirtyStateChange = () => {
    this.saveCallbacks.forEach((callback) => callback())
  }

  // Subscribe to dirty state changes
  onDirtyStateChange = (callback: () => void) => {
    this.saveCallbacks.push(callback)
    return () => {
      this.saveCallbacks = this.saveCallbacks.filter((cb) => cb !== callback)
    }
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
    const workflowStore = useWorkflowStore.getState()
    workflowStore.addBlock(id, type, name, position, data, parentId, extent)
    this.markDirty(`block-add-${id}`)
  }

  updateBlockPosition = (id: string, position: Position) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.updateBlockPosition(id, position)
    this.markDirty(`block-position-${id}`)
  }

  updateBlockName = (id: string, name: string) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.updateBlockName(id, name)
    this.markDirty(`block-name-${id}`)
  }

  removeBlock = (id: string) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.removeBlock(id)
    this.markDirty(`block-remove-${id}`)
  }

  toggleBlockEnabled = (id: string) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.toggleBlockEnabled(id)
    this.markDirty(`block-enabled-${id}`)
  }

  updateParentId = (id: string, parentId: string, extent: 'parent') => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.updateParentId(id, parentId, extent)
    this.markDirty(`block-parent-${id}`)
  }

  // Edge operations
  addEdge = (edge: Edge) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.addEdge(edge)
    this.markDirty(`edge-add-${edge.id}`)
  }

  removeEdge = (edgeId: string) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.removeEdge(edgeId)
    this.markDirty(`edge-remove-${edgeId}`)
  }

  // Subblock operations
  setSubblockValue = (blockId: string, subblockId: string, value: any) => {
    const subBlockStore = useSubBlockStore.getState()
    subBlockStore.setValue(blockId, subblockId, value)
    this.markDirty(`subblock-${blockId}-${subblockId}`)
  }

  // Loop/parallel operations
  updateLoopCount = (loopId: string, count: number) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.updateLoopCount(loopId, count)
    this.markDirty(`loop-count-${loopId}`)
  }

  updateLoopType = (loopId: string, type: string) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.updateLoopType(loopId, type)
    this.markDirty(`loop-type-${loopId}`)
  }

  updateLoopCollection = (loopId: string, collection: string) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.updateLoopCollection(loopId, collection)
    this.markDirty(`loop-collection-${loopId}`)
  }

  updateParallelCount = (parallelId: string, count: number) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.updateParallelCount(parallelId, count)
    this.markDirty(`parallel-count-${parallelId}`)
  }

  updateParallelCollection = (parallelId: string, collection: string) => {
    const workflowStore = useWorkflowStore.getState()
    workflowStore.updateParallelCollection(parallelId, collection)
    this.markDirty(`parallel-collection-${parallelId}`)
  }

  // State management
  isDirty = () => this.dirtyState.size > 0

  save = async () => {
    if (!this.isDirty()) return

    try {
      logger.info(`Saving workflow ${this.workflowId} with ${this.dirtyState.size} changes`)

      // Get current workflow state
      const workflowStore = useWorkflowStore.getState()
      const subBlockStore = useSubBlockStore.getState()

      const workflowState = {
        blocks: workflowStore.blocks,
        edges: workflowStore.edges,
        loops: workflowStore.loops,
        parallels: workflowStore.parallels,
        lastSaved: Date.now(),
        isDeployed: workflowStore.isDeployed,
        deployedAt: workflowStore.deployedAt,
        deploymentStatuses: workflowStore.deploymentStatuses,
        hasActiveSchedule: workflowStore.hasActiveSchedule,
        hasActiveWebhook: workflowStore.hasActiveWebhook,
      }

      // Save to database via API
      const response = await fetch(`/api/workflows/${this.workflowId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state: workflowState,
          subblockValues: subBlockStore.workflowValues[this.workflowId] || {},
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to save workflow: ${response.statusText}`)
      }

      // Clear dirty state on successful save
      this.dirtyState.clear()
      workflowStore.updateLastSaved()
      this.notifyDirtyStateChange()

      logger.info(`Successfully saved workflow ${this.workflowId}`)
    } catch (error) {
      logger.error(`Failed to save workflow ${this.workflowId}:`, error)
      throw error
    }
  }

  // Connection status - always true for local mode
  get isConnected() {
    return true
  }

  get currentWorkflowId() {
    return this.workflowId
  }
}

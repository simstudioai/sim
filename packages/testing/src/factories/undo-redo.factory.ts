import { nanoid } from 'nanoid'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Operation types supported by the undo/redo store.
 */
export type OperationType =
  | 'batch-add-blocks'
  | 'batch-remove-blocks'
  | 'add-edge'
  | 'remove-edge'
  | 'move-block'
  | 'update-parent'

/**
 * Base operation interface.
 */
export interface BaseOperation {
  id: string
  type: OperationType
  timestamp: number
  workflowId: string
  userId: string
}

/**
 * Move block operation data.
 */
export interface MoveBlockOperation extends BaseOperation {
  type: 'move-block'
  data: {
    blockId: string
    before: { x: number; y: number; parentId?: string }
    after: { x: number; y: number; parentId?: string }
  }
}

/**
 * Batch add blocks operation data.
 */
export interface BatchAddBlocksOperation extends BaseOperation {
  type: 'batch-add-blocks'
  data: {
    blockSnapshots: any[]
    edgeSnapshots: any[]
    subBlockValues: Record<string, Record<string, any>>
  }
}

/**
 * Batch remove blocks operation data.
 */
export interface BatchRemoveBlocksOperation extends BaseOperation {
  type: 'batch-remove-blocks'
  data: {
    blockSnapshots: any[]
    edgeSnapshots: any[]
    subBlockValues: Record<string, Record<string, any>>
  }
}

/**
 * Add edge operation data.
 */
export interface AddEdgeOperation extends BaseOperation {
  type: 'add-edge'
  data: { edgeId: string }
}

/**
 * Remove edge operation data.
 */
export interface RemoveEdgeOperation extends BaseOperation {
  type: 'remove-edge'
  data: { edgeId: string; edgeSnapshot: any }
}

/**
 * Update parent operation data.
 */
export interface UpdateParentOperation extends BaseOperation {
  type: 'update-parent'
  data: {
    blockId: string
    oldParentId?: string
    newParentId?: string
    oldPosition: { x: number; y: number }
    newPosition: { x: number; y: number }
  }
}

export type Operation =
  | BatchAddBlocksOperation
  | BatchRemoveBlocksOperation
  | AddEdgeOperation
  | RemoveEdgeOperation
  | MoveBlockOperation
  | UpdateParentOperation

/**
 * Operation entry with forward and inverse operations.
 */
export interface OperationEntry {
  id: string
  operation: Operation
  inverse: Operation
  createdAt: number
}

interface OperationEntryOptions {
  id?: string
  workflowId?: string
  userId?: string
  createdAt?: number
}

/**
 * Creates a mock batch-add-blocks operation entry.
 */
export function createAddBlockEntry(blockId: string, options: OperationEntryOptions = {}): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  const mockBlockSnapshot = {
    id: blockId,
    type: 'action',
    name: `Block ${blockId}`,
    position: { x: 0, y: 0 },
  }

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'batch-add-blocks',
      timestamp,
      workflowId,
      userId,
      data: {
        blockSnapshots: [mockBlockSnapshot],
        edgeSnapshots: [],
        subBlockValues: {},
      },
    },
    inverse: {
      id: nanoid(8),
      type: 'batch-remove-blocks',
      timestamp,
      workflowId,
      userId,
      data: {
        blockSnapshots: [mockBlockSnapshot],
        edgeSnapshots: [],
        subBlockValues: {},
      },
    },
  }
}

/**
 * Creates a mock batch-remove-blocks operation entry.
 */
export function createRemoveBlockEntry(
  blockId: string,
  blockSnapshot: any = null,
  options: OperationEntryOptions = {}
): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  const snapshotToUse = blockSnapshot || {
    id: blockId,
    type: 'action',
    name: `Block ${blockId}`,
    position: { x: 0, y: 0 },
  }

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'batch-remove-blocks',
      timestamp,
      workflowId,
      userId,
      data: {
        blockSnapshots: [snapshotToUse],
        edgeSnapshots: [],
        subBlockValues: {},
      },
    },
    inverse: {
      id: nanoid(8),
      type: 'batch-add-blocks',
      timestamp,
      workflowId,
      userId,
      data: {
        blockSnapshots: [snapshotToUse],
        edgeSnapshots: [],
        subBlockValues: {},
      },
    },
  }
}

/**
 * Creates a mock add-edge operation entry.
 */
export function createAddEdgeEntry(edgeId: string, options: OperationEntryOptions = {}): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'add-edge',
      timestamp,
      workflowId,
      userId,
      data: { edgeId },
    },
    inverse: {
      id: nanoid(8),
      type: 'remove-edge',
      timestamp,
      workflowId,
      userId,
      data: { edgeId, edgeSnapshot: null },
    },
  }
}

/**
 * Creates a mock remove-edge operation entry.
 */
export function createRemoveEdgeEntry(
  edgeId: string,
  edgeSnapshot: any = null,
  options: OperationEntryOptions = {}
): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'remove-edge',
      timestamp,
      workflowId,
      userId,
      data: { edgeId, edgeSnapshot },
    },
    inverse: {
      id: nanoid(8),
      type: 'add-edge',
      timestamp,
      workflowId,
      userId,
      data: { edgeId },
    },
  }
}

interface MoveBlockOptions extends OperationEntryOptions {
  before?: { x: number; y: number; parentId?: string }
  after?: { x: number; y: number; parentId?: string }
}

/**
 * Creates a mock move-block operation entry.
 */
export function createMoveBlockEntry(blockId: string, options: MoveBlockOptions = {}): any {
  const {
    id = nanoid(8),
    workflowId = 'wf-1',
    userId = 'user-1',
    createdAt = Date.now(),
    before = { x: 0, y: 0 },
    after = { x: 100, y: 100 },
  } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'move-block',
      timestamp,
      workflowId,
      userId,
      data: { blockId, before, after },
    },
    inverse: {
      id: nanoid(8),
      type: 'move-block',
      timestamp,
      workflowId,
      userId,
      data: { blockId, before: after, after: before },
    },
  }
}

/**
 * Creates a mock update-parent operation entry.
 */
export function createUpdateParentEntry(
  blockId: string,
  options: OperationEntryOptions & {
    oldParentId?: string
    newParentId?: string
    oldPosition?: { x: number; y: number }
    newPosition?: { x: number; y: number }
  } = {}
): any {
  const {
    id = nanoid(8),
    workflowId = 'wf-1',
    userId = 'user-1',
    createdAt = Date.now(),
    oldParentId,
    newParentId,
    oldPosition = { x: 0, y: 0 },
    newPosition = { x: 50, y: 50 },
  } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'update-parent',
      timestamp,
      workflowId,
      userId,
      data: { blockId, oldParentId, newParentId, oldPosition, newPosition },
    },
    inverse: {
      id: nanoid(8),
      type: 'update-parent',
      timestamp,
      workflowId,
      userId,
      data: {
        blockId,
        oldParentId: newParentId,
        newParentId: oldParentId,
        oldPosition: newPosition,
        newPosition: oldPosition,
      },
    },
  }
}

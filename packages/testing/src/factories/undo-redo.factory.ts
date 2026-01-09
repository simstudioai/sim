import { nanoid } from 'nanoid'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Operation types supported by the undo/redo store.
 */
export type OperationType =
  | 'batch-add-blocks'
  | 'batch-remove-blocks'
  | 'batch-add-edges'
  | 'batch-remove-edges'
  | 'batch-move-blocks'
  | 'update-parent'
  | 'batch-update-parent'

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
 * Batch move blocks operation data.
 */
export interface BatchMoveBlocksOperation extends BaseOperation {
  type: 'batch-move-blocks'
  data: {
    moves: Array<{
      blockId: string
      before: { x: number; y: number; parentId?: string }
      after: { x: number; y: number; parentId?: string }
    }>
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
 * Batch add edges operation data.
 */
export interface BatchAddEdgesOperation extends BaseOperation {
  type: 'batch-add-edges'
  data: { edgeSnapshots: any[] }
}

/**
 * Batch remove edges operation data.
 */
export interface BatchRemoveEdgesOperation extends BaseOperation {
  type: 'batch-remove-edges'
  data: { edgeSnapshots: any[] }
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

export interface BatchUpdateParentOperation extends BaseOperation {
  type: 'batch-update-parent'
  data: {
    updates: Array<{
      blockId: string
      oldParentId?: string
      newParentId?: string
      oldPosition: { x: number; y: number }
      newPosition: { x: number; y: number }
      affectedEdges?: any[]
    }>
  }
}

export type Operation =
  | BatchAddBlocksOperation
  | BatchRemoveBlocksOperation
  | BatchAddEdgesOperation
  | BatchRemoveEdgesOperation
  | BatchMoveBlocksOperation
  | UpdateParentOperation
  | BatchUpdateParentOperation

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
 * Creates a mock batch-add-edges operation entry for a single edge.
 */
export function createAddEdgeEntry(
  edgeId: string,
  edgeSnapshot: any = null,
  options: OperationEntryOptions = {}
): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  const snapshot = edgeSnapshot || { id: edgeId, source: 'block-1', target: 'block-2' }

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'batch-add-edges',
      timestamp,
      workflowId,
      userId,
      data: { edgeSnapshots: [snapshot] },
    },
    inverse: {
      id: nanoid(8),
      type: 'batch-remove-edges',
      timestamp,
      workflowId,
      userId,
      data: { edgeSnapshots: [snapshot] },
    },
  }
}

/**
 * Creates a mock batch-remove-edges operation entry.
 */
export function createBatchRemoveEdgesEntry(
  edgeSnapshots: any[],
  options: OperationEntryOptions = {}
): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'batch-remove-edges',
      timestamp,
      workflowId,
      userId,
      data: { edgeSnapshots },
    },
    inverse: {
      id: nanoid(8),
      type: 'batch-add-edges',
      timestamp,
      workflowId,
      userId,
      data: { edgeSnapshots },
    },
  }
}

interface MoveBlockOptions extends OperationEntryOptions {
  before?: { x: number; y: number; parentId?: string }
  after?: { x: number; y: number; parentId?: string }
}

/**
 * Creates a mock batch-move-blocks operation entry for a single block.
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
      type: 'batch-move-blocks',
      timestamp,
      workflowId,
      userId,
      data: { moves: [{ blockId, before, after }] },
    },
    inverse: {
      id: nanoid(8),
      type: 'batch-move-blocks',
      timestamp,
      workflowId,
      userId,
      data: { moves: [{ blockId, before: after, after: before }] },
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

interface BatchUpdateParentOptions extends OperationEntryOptions {
  updates?: Array<{
    blockId: string
    oldParentId?: string
    newParentId?: string
    oldPosition?: { x: number; y: number }
    newPosition?: { x: number; y: number }
    affectedEdges?: any[]
  }>
}

/**
 * Creates a mock batch-update-parent operation entry.
 */
export function createBatchUpdateParentEntry(options: BatchUpdateParentOptions = {}): any {
  const {
    id = nanoid(8),
    workflowId = 'wf-1',
    userId = 'user-1',
    createdAt = Date.now(),
    updates = [
      {
        blockId: 'block-1',
        oldParentId: undefined,
        newParentId: 'loop-1',
        oldPosition: { x: 0, y: 0 },
        newPosition: { x: 50, y: 50 },
      },
    ],
  } = options
  const timestamp = Date.now()

  const processedUpdates = updates.map((u) => ({
    blockId: u.blockId,
    oldParentId: u.oldParentId,
    newParentId: u.newParentId,
    oldPosition: u.oldPosition || { x: 0, y: 0 },
    newPosition: u.newPosition || { x: 50, y: 50 },
    affectedEdges: u.affectedEdges,
  }))

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'batch-update-parent',
      timestamp,
      workflowId,
      userId,
      data: { updates: processedUpdates },
    },
    inverse: {
      id: nanoid(8),
      type: 'batch-update-parent',
      timestamp,
      workflowId,
      userId,
      data: {
        updates: processedUpdates.map((u) => ({
          blockId: u.blockId,
          oldParentId: u.newParentId,
          newParentId: u.oldParentId,
          oldPosition: u.newPosition,
          newPosition: u.oldPosition,
          affectedEdges: u.affectedEdges,
        })),
      },
    },
  }
}

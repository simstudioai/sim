import { nanoid } from 'nanoid'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Operation types supported by the undo/redo store.
 */
export type OperationType =
  | 'add-block'
  | 'remove-block'
  | 'add-edge'
  | 'remove-edge'
  | 'move-block'
  | 'duplicate-block'
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
 * Add block operation data.
 */
export interface AddBlockOperation extends BaseOperation {
  type: 'add-block'
  data: { blockId: string }
}

/**
 * Remove block operation data.
 */
export interface RemoveBlockOperation extends BaseOperation {
  type: 'remove-block'
  data: {
    blockId: string
    blockSnapshot: any
    edgeSnapshots?: any[]
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
 * Duplicate block operation data.
 */
export interface DuplicateBlockOperation extends BaseOperation {
  type: 'duplicate-block'
  data: {
    sourceBlockId: string
    duplicatedBlockId: string
    duplicatedBlockSnapshot: any
  }
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
  | AddBlockOperation
  | RemoveBlockOperation
  | AddEdgeOperation
  | RemoveEdgeOperation
  | MoveBlockOperation
  | DuplicateBlockOperation
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
 * Creates a mock add-block operation entry.
 */
export function createAddBlockEntry(blockId: string, options: OperationEntryOptions = {}): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'add-block',
      timestamp,
      workflowId,
      userId,
      data: { blockId },
    },
    inverse: {
      id: nanoid(8),
      type: 'remove-block',
      timestamp,
      workflowId,
      userId,
      data: { blockId, blockSnapshot: null },
    },
  }
}

/**
 * Creates a mock remove-block operation entry.
 */
export function createRemoveBlockEntry(
  blockId: string,
  blockSnapshot: any = null,
  options: OperationEntryOptions = {}
): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'remove-block',
      timestamp,
      workflowId,
      userId,
      data: { blockId, blockSnapshot },
    },
    inverse: {
      id: nanoid(8),
      type: 'add-block',
      timestamp,
      workflowId,
      userId,
      data: { blockId },
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
 * Creates a mock duplicate-block operation entry.
 */
export function createDuplicateBlockEntry(
  sourceBlockId: string,
  duplicatedBlockId: string,
  duplicatedBlockSnapshot: any,
  options: OperationEntryOptions = {}
): any {
  const { id = nanoid(8), workflowId = 'wf-1', userId = 'user-1', createdAt = Date.now() } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: nanoid(8),
      type: 'duplicate-block',
      timestamp,
      workflowId,
      userId,
      data: { sourceBlockId, duplicatedBlockId, duplicatedBlockSnapshot },
    },
    inverse: {
      id: nanoid(8),
      type: 'remove-block',
      timestamp,
      workflowId,
      userId,
      data: { blockId: duplicatedBlockId, blockSnapshot: duplicatedBlockSnapshot },
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

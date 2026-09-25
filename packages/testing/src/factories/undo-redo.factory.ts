import { shortId } from './id'

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
  const {
    id = shortId(8),
    workflowId = 'wf-1',
    userId = 'user-1',
    createdAt = Date.now(),
  } = options
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
      id: shortId(8),
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
      id: shortId(8),
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
  const {
    id = shortId(8),
    workflowId = 'wf-1',
    userId = 'user-1',
    createdAt = Date.now(),
  } = options
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
      id: shortId(8),
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
      id: shortId(8),
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
 * Creates a mock batch-remove-edges operation entry.
 */
export function createBatchRemoveEdgesEntry(
  edgeSnapshots: any[],
  options: OperationEntryOptions = {}
): any {
  const {
    id = shortId(8),
    workflowId = 'wf-1',
    userId = 'user-1',
    createdAt = Date.now(),
  } = options
  const timestamp = Date.now()

  return {
    id,
    createdAt,
    operation: {
      id: shortId(8),
      type: 'batch-remove-edges',
      timestamp,
      workflowId,
      userId,
      data: { edgeSnapshots },
    },
    inverse: {
      id: shortId(8),
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
    id = shortId(8),
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
      id: shortId(8),
      type: 'batch-move-blocks',
      timestamp,
      workflowId,
      userId,
      data: { moves: [{ blockId, before, after }] },
    },
    inverse: {
      id: shortId(8),
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
    id = shortId(8),
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
      id: shortId(8),
      type: 'update-parent',
      timestamp,
      workflowId,
      userId,
      data: { blockId, oldParentId, newParentId, oldPosition, newPosition },
    },
    inverse: {
      id: shortId(8),
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

export const BLOCK_OPERATIONS = {
  UPDATE_POSITION: 'update-position',
  UPDATE_NAME: 'update-name',
  TOGGLE_ENABLED: 'toggle-enabled',
  UPDATE_PARENT: 'update-parent',
  UPDATE_ADVANCED_MODE: 'update-advanced-mode',
  UPDATE_CANONICAL_MODE: 'update-canonical-mode',
  TOGGLE_HANDLES: 'toggle-handles',
} as const

export type BlockOperation = (typeof BLOCK_OPERATIONS)[keyof typeof BLOCK_OPERATIONS]

export const BLOCKS_OPERATIONS = {
  BATCH_UPDATE_POSITIONS: 'batch-update-positions',
  BATCH_ADD_BLOCKS: 'batch-add-blocks',
  BATCH_REMOVE_BLOCKS: 'batch-remove-blocks',
  BATCH_TOGGLE_ENABLED: 'batch-toggle-enabled',
  BATCH_TOGGLE_HANDLES: 'batch-toggle-handles',
  BATCH_UPDATE_PARENT: 'batch-update-parent',
  BATCH_TOGGLE_LOCKED: 'batch-toggle-locked',
} as const

export type BlocksOperation = (typeof BLOCKS_OPERATIONS)[keyof typeof BLOCKS_OPERATIONS]

export const EDGE_OPERATIONS = {
  ADD: 'add',
  REMOVE: 'remove',
} as const

export type EdgeOperation = (typeof EDGE_OPERATIONS)[keyof typeof EDGE_OPERATIONS]

export const EDGES_OPERATIONS = {
  BATCH_ADD_EDGES: 'batch-add-edges',
  BATCH_REMOVE_EDGES: 'batch-remove-edges',
} as const

export type EdgesOperation = (typeof EDGES_OPERATIONS)[keyof typeof EDGES_OPERATIONS]

export const SUBFLOW_OPERATIONS = {
  UPDATE: 'update',
} as const

export type SubflowOperation = (typeof SUBFLOW_OPERATIONS)[keyof typeof SUBFLOW_OPERATIONS]

export const VARIABLE_OPERATIONS = {
  ADD: 'add',
  REMOVE: 'remove',
  UPDATE: 'variable-update',
} as const

export type VariableOperation = (typeof VARIABLE_OPERATIONS)[keyof typeof VARIABLE_OPERATIONS]

export const WORKFLOW_OPERATIONS = {
  REPLACE_STATE: 'replace-state',
} as const

export type WorkflowOperation = (typeof WORKFLOW_OPERATIONS)[keyof typeof WORKFLOW_OPERATIONS]

export const SUBBLOCK_OPERATIONS = {
  UPDATE: 'subblock-update',
} as const

export type SubblockOperation = (typeof SUBBLOCK_OPERATIONS)[keyof typeof SUBBLOCK_OPERATIONS]

export const OPERATION_TARGETS = {
  BLOCK: 'block',
  BLOCKS: 'blocks',
  EDGE: 'edge',
  EDGES: 'edges',
  SUBBLOCK: 'subblock',
  SUBFLOW: 'subflow',
  VARIABLE: 'variable',
  WORKFLOW: 'workflow',
} as const

export type OperationTarget = (typeof OPERATION_TARGETS)[keyof typeof OPERATION_TARGETS]

/** Undo/Redo operation types (includes some socket operations + undo-specific ones) */
export const UNDO_REDO_OPERATIONS = {
  BATCH_ADD_BLOCKS: 'batch-add-blocks',
  BATCH_REMOVE_BLOCKS: 'batch-remove-blocks',
  BATCH_ADD_EDGES: 'batch-add-edges',
  BATCH_REMOVE_EDGES: 'batch-remove-edges',
  BATCH_MOVE_BLOCKS: 'batch-move-blocks',
  UPDATE_PARENT: 'update-parent',
  BATCH_UPDATE_PARENT: 'batch-update-parent',
  BATCH_TOGGLE_ENABLED: 'batch-toggle-enabled',
  BATCH_TOGGLE_HANDLES: 'batch-toggle-handles',
  BATCH_TOGGLE_LOCKED: 'batch-toggle-locked',
  APPLY_DIFF: 'apply-diff',
  ACCEPT_DIFF: 'accept-diff',
  REJECT_DIFF: 'reject-diff',
} as const

export type UndoRedoOperation = (typeof UNDO_REDO_OPERATIONS)[keyof typeof UNDO_REDO_OPERATIONS]

/**
 * All socket operations that require permission checks.
 * This is the single source of truth for valid operations.
 */
export const ALL_SOCKET_OPERATIONS = [
  ...Object.values(BLOCK_OPERATIONS),
  ...Object.values(BLOCKS_OPERATIONS),
  ...Object.values(EDGE_OPERATIONS),
  ...Object.values(EDGES_OPERATIONS),
  ...Object.values(WORKFLOW_OPERATIONS),
  ...Object.values(SUBBLOCK_OPERATIONS),
  ...Object.values(VARIABLE_OPERATIONS),
  ...Object.values(SUBFLOW_OPERATIONS),
] as const

export type SocketOperation = (typeof ALL_SOCKET_OPERATIONS)[number]

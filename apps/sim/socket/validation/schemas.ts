import { z } from 'zod'
import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGE_OPERATIONS,
  EDGES_OPERATIONS,
  OPERATION_TARGETS,
  SUBFLOW_OPERATIONS,
  VARIABLE_OPERATIONS,
  WORKFLOW_OPERATIONS,
} from '@/socket/constants'

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const AutoConnectEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  type: z.string().optional(),
})

export const BlockOperationSchema = z.object({
  operation: z.enum([
    BLOCK_OPERATIONS.UPDATE_POSITION,
    BLOCK_OPERATIONS.UPDATE_NAME,
    BLOCK_OPERATIONS.TOGGLE_ENABLED,
    BLOCK_OPERATIONS.UPDATE_PARENT,
    BLOCK_OPERATIONS.UPDATE_ADVANCED_MODE,
    BLOCK_OPERATIONS.UPDATE_CANONICAL_MODE,
    BLOCK_OPERATIONS.TOGGLE_HANDLES,
  ]),
  target: z.literal(OPERATION_TARGETS.BLOCK),
  payload: z.object({
    id: z.string(),
    type: z.string().optional(),
    name: z.string().optional(),
    position: PositionSchema.optional(),
    commit: z.boolean().optional(),
    data: z.record(z.any()).optional(),
    subBlocks: z.record(z.any()).optional(),
    outputs: z.record(z.any()).optional(),
    parentId: z.string().nullable().optional(),
    extent: z.enum(['parent']).nullable().optional(),
    enabled: z.boolean().optional(),
    advancedMode: z.boolean().optional(),
    horizontalHandles: z.boolean().optional(),
    canonicalId: z.string().optional(),
    canonicalMode: z.enum(['basic', 'advanced']).optional(),
    triggerMode: z.boolean().optional(),
    height: z.number().optional(),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchPositionUpdateSchema = z.object({
  operation: z.literal(BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS),
  target: z.literal(OPERATION_TARGETS.BLOCKS),
  payload: z.object({
    updates: z.array(
      z.object({
        id: z.string(),
        position: PositionSchema,
      })
    ),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const EdgeOperationSchema = z.object({
  operation: z.enum([EDGE_OPERATIONS.ADD, EDGE_OPERATIONS.REMOVE]),
  target: z.literal(OPERATION_TARGETS.EDGE),
  payload: z.object({
    id: z.string(),
    source: z.string().optional(),
    target: z.string().optional(),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const SubflowOperationSchema = z.object({
  operation: z.literal(SUBFLOW_OPERATIONS.UPDATE),
  target: z.literal(OPERATION_TARGETS.SUBFLOW),
  payload: z.object({
    id: z.string(),
    type: z.enum(['loop', 'parallel']).optional(),
    config: z.record(z.any()).optional(),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const VariableOperationSchema = z.union([
  z.object({
    operation: z.literal(VARIABLE_OPERATIONS.ADD),
    target: z.literal(OPERATION_TARGETS.VARIABLE),
    payload: z.object({
      id: z.string(),
      name: z.string(),
      type: z.any(),
      value: z.any(),
      workflowId: z.string(),
    }),
    timestamp: z.number(),
    operationId: z.string().optional(),
  }),
  z.object({
    operation: z.literal(VARIABLE_OPERATIONS.REMOVE),
    target: z.literal(OPERATION_TARGETS.VARIABLE),
    payload: z.object({
      variableId: z.string(),
    }),
    timestamp: z.number(),
    operationId: z.string().optional(),
  }),
])

export const WorkflowStateOperationSchema = z.object({
  operation: z.literal(WORKFLOW_OPERATIONS.REPLACE_STATE),
  target: z.literal(OPERATION_TARGETS.WORKFLOW),
  payload: z.object({
    state: z.any(),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchAddBlocksSchema = z.object({
  operation: z.literal(BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS),
  target: z.literal(OPERATION_TARGETS.BLOCKS),
  payload: z.object({
    blocks: z.array(z.record(z.any())),
    edges: z.array(AutoConnectEdgeSchema).optional(),
    loops: z.record(z.any()).optional(),
    parallels: z.record(z.any()).optional(),
    subBlockValues: z.record(z.record(z.any())).optional(),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchRemoveBlocksSchema = z.object({
  operation: z.literal(BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS),
  target: z.literal(OPERATION_TARGETS.BLOCKS),
  payload: z.object({
    ids: z.array(z.string()),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchRemoveEdgesSchema = z.object({
  operation: z.literal(EDGES_OPERATIONS.BATCH_REMOVE_EDGES),
  target: z.literal(OPERATION_TARGETS.EDGES),
  payload: z.object({
    ids: z.array(z.string()),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchAddEdgesSchema = z.object({
  operation: z.literal(EDGES_OPERATIONS.BATCH_ADD_EDGES),
  target: z.literal(OPERATION_TARGETS.EDGES),
  payload: z.object({
    edges: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().nullable().optional(),
        targetHandle: z.string().nullable().optional(),
      })
    ),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchToggleEnabledSchema = z.object({
  operation: z.literal(BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED),
  target: z.literal(OPERATION_TARGETS.BLOCKS),
  payload: z.object({
    blockIds: z.array(z.string()),
    previousStates: z.record(z.boolean()),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchToggleHandlesSchema = z.object({
  operation: z.literal(BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES),
  target: z.literal(OPERATION_TARGETS.BLOCKS),
  payload: z.object({
    blockIds: z.array(z.string()),
    previousStates: z.record(z.boolean()),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchToggleLockedSchema = z.object({
  operation: z.literal(BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED),
  target: z.literal(OPERATION_TARGETS.BLOCKS),
  payload: z.object({
    blockIds: z.array(z.string()),
    previousStates: z.record(z.boolean()),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchUpdateParentSchema = z.object({
  operation: z.literal(BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT),
  target: z.literal(OPERATION_TARGETS.BLOCKS),
  payload: z.object({
    updates: z.array(
      z.object({
        id: z.string(),
        parentId: z.string(),
        position: PositionSchema,
      })
    ),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const WorkflowOperationSchema = z.union([
  BlockOperationSchema,
  BatchPositionUpdateSchema,
  BatchAddBlocksSchema,
  BatchRemoveBlocksSchema,
  BatchToggleEnabledSchema,
  BatchToggleHandlesSchema,
  BatchToggleLockedSchema,
  BatchUpdateParentSchema,
  EdgeOperationSchema,
  BatchAddEdgesSchema,
  BatchRemoveEdgesSchema,
  SubflowOperationSchema,
  VariableOperationSchema,
  WorkflowStateOperationSchema,
])

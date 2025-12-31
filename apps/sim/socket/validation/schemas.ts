import { z } from 'zod'

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

// Schema for auto-connect edge data
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
    'update-position',
    'update-name',
    'toggle-enabled',
    'update-parent',
    'update-wide',
    'update-advanced-mode',
    'update-trigger-mode',
    'toggle-handles',
  ]),
  target: z.literal('block'),
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
    horizontalHandles: z.boolean().optional(),
    advancedMode: z.boolean().optional(),
    triggerMode: z.boolean().optional(),
    height: z.number().optional(),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchPositionUpdateSchema = z.object({
  operation: z.literal('batch-update-positions'),
  target: z.literal('blocks'),
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
  operation: z.enum(['add', 'remove']),
  target: z.literal('edge'),
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
  operation: z.enum(['add', 'remove', 'update']),
  target: z.literal('subflow'),
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
    operation: z.literal('add'),
    target: z.literal('variable'),
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
    operation: z.literal('remove'),
    target: z.literal('variable'),
    payload: z.object({
      variableId: z.string(),
    }),
    timestamp: z.number(),
    operationId: z.string().optional(),
  }),
])

export const WorkflowStateOperationSchema = z.object({
  operation: z.literal('replace-state'),
  target: z.literal('workflow'),
  payload: z.object({
    state: z.any(),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const BatchAddBlocksSchema = z.object({
  operation: z.literal('batch-add-blocks'),
  target: z.literal('blocks'),
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
  operation: z.literal('batch-remove-blocks'),
  target: z.literal('blocks'),
  payload: z.object({
    ids: z.array(z.string()),
  }),
  timestamp: z.number(),
  operationId: z.string().optional(),
})

export const WorkflowOperationSchema = z.union([
  BlockOperationSchema,
  BatchPositionUpdateSchema,
  BatchAddBlocksSchema,
  BatchRemoveBlocksSchema,
  EdgeOperationSchema,
  SubflowOperationSchema,
  VariableOperationSchema,
  WorkflowStateOperationSchema,
])

export { PositionSchema, AutoConnectEdgeSchema }

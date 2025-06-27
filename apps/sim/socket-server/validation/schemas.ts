import { z } from 'zod'

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export const BlockOperationSchema = z.object({
  operation: z.enum([
    'add',
    'remove',
    'update-position',
    'update-name',
    'toggle-enabled',
    'update-parent',
    'update-wide',
    'update-advanced-mode',
    'toggle-handles',
    'duplicate',
  ]),
  target: z.literal('block'),
  payload: z.object({
    id: z.string(),
    sourceId: z.string().optional(), // For duplicate operations
    type: z.string().optional(),
    name: z.string().optional(),
    position: PositionSchema.optional(),
    data: z.record(z.any()).optional(),
    subBlocks: z.record(z.any()).optional(),
    outputs: z.record(z.any()).optional(),
    parentId: z.string().nullable().optional(),
    extent: z.enum(['parent']).nullable().optional(),
    enabled: z.boolean().optional(),
    horizontalHandles: z.boolean().optional(),
    isWide: z.boolean().optional(),
    advancedMode: z.boolean().optional(),
    height: z.number().optional(),
  }),
  timestamp: z.number(),
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
})

export const WorkflowOperationSchema = z.union([
  BlockOperationSchema,
  EdgeOperationSchema,
  SubflowOperationSchema,
])

export { PositionSchema }

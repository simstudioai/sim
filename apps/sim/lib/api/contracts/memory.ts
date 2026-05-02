import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const memoryIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const memoryWorkspaceQuerySchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
})

const agentMemoryDataSchema = z.object({
  role: z.enum(['user', 'assistant', 'system'], {
    error: 'Role must be user, assistant, or system',
  }),
  content: z.string().min(1, 'Content is required'),
})

const genericMemoryDataSchema = z.record(z.string(), z.unknown())

export const memoryPutBodySchema = z.object({
  data: z.union([agentMemoryDataSchema, genericMemoryDataSchema], {
    error: 'Invalid memory data structure',
  }),
  workspaceId: z.string().uuid('Invalid workspace ID format'),
})
export type MemoryPutBody = z.input<typeof memoryPutBodySchema>

export const agentMemoryDataSchemaContract = agentMemoryDataSchema

export const memoryListQuerySchema = z.object({
  workspaceId: z.string().optional(),
  query: z.string().nullable().optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => Number.parseInt(value || '50')),
})

export const memoryMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.unknown().refine((value) => Boolean(value)),
  })
  .passthrough()

export const memoryPostBodySchema = z
  .object({
    key: z.string().optional(),
    data: z.unknown().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough()
export type MemoryPostBody = z.input<typeof memoryPostBodySchema>

export const memoryDeleteQuerySchema = z.object({
  workspaceId: z.string().optional(),
  conversationId: z.string().optional(),
})

const memorySuccessResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

const memoryRecordSchema = z.object({
  conversationId: z.string(),
  data: z.unknown(),
})

export const listMemoriesContract = defineRouteContract({
  method: 'GET',
  path: '/api/memory',
  query: memoryListQuerySchema,
  response: {
    mode: 'json',
    schema: memorySuccessResponseSchema(
      z.object({
        memories: z.array(memoryRecordSchema),
      })
    ),
  },
})

export const createMemoryContract = defineRouteContract({
  method: 'POST',
  path: '/api/memory',
  body: memoryPostBodySchema,
  response: {
    mode: 'json',
    schema: memorySuccessResponseSchema(memoryRecordSchema),
  },
})

export const deleteMemoryByQueryContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/memory',
  query: memoryDeleteQuerySchema,
  response: {
    mode: 'json',
    schema: memorySuccessResponseSchema(
      z.object({
        message: z.string(),
        deletedCount: z.number(),
      })
    ),
  },
})

export const getMemoryByIdContract = defineRouteContract({
  method: 'GET',
  path: '/api/memory/[id]',
  params: memoryIdParamsSchema,
  query: memoryWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: memorySuccessResponseSchema(memoryRecordSchema),
  },
})

export const deleteMemoryByIdContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/memory/[id]',
  params: memoryIdParamsSchema,
  query: memoryWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: memorySuccessResponseSchema(z.object({ message: z.string() })),
  },
})

export const updateMemoryByIdContract = defineRouteContract({
  method: 'PUT',
  path: '/api/memory/[id]',
  params: memoryIdParamsSchema,
  body: memoryPutBodySchema,
  response: {
    mode: 'json',
    schema: memorySuccessResponseSchema(memoryRecordSchema),
  },
})

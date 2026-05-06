import { z } from 'zod'
import { toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const fileManageQuerySchema = z.object({
  userId: z.string().min(1).nullable().optional(),
  workspaceId: z.string().min(1).nullable().optional(),
})

export const fileManageWriteBodySchema = z.object({
  operation: z.literal('write'),
  workspaceId: z.string().min(1).optional(),
  fileName: z.string({ error: 'fileName is required for write operation' }).min(1),
  content: z.string({ error: 'content is required for write operation' }),
  contentType: z.string().optional(),
})

export const fileManageAppendBodySchema = z.object({
  operation: z.literal('append'),
  workspaceId: z.string().min(1).optional(),
  fileName: z.string({ error: 'fileName is required for append operation' }).min(1),
  content: z.string({ error: 'content is required for append operation' }),
})

export const fileManageBodySchema = z.discriminatedUnion('operation', [
  fileManageWriteBodySchema,
  fileManageAppendBodySchema,
])

export const fileManageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/file/manage',
  query: fileManageQuerySchema,
  body: fileManageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

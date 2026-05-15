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

export const fileManageGetBodySchema = z
  .object({
    operation: z.literal('get'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    fileInput: z.unknown().optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for get operation',
  })

export const fileManageMoveBodySchema = z.object({
  operation: z.literal('move'),
  workspaceId: z.string().min(1).optional(),
  fileId: z.string().min(1, 'fileId is required for move operation'),
  targetFolder: z.string().optional().default(''),
})

export type FileManageMoveBody = z.input<typeof fileManageMoveBodySchema>

export const fileManageReadBodySchema = z
  .object({
    operation: z.literal('read'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    fileInput: z.unknown().optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for read operation',
  })

export const fileManageBodySchema = z.union([
  fileManageWriteBodySchema,
  fileManageAppendBodySchema,
  fileManageGetBodySchema,
  fileManageMoveBodySchema,
  fileManageReadBodySchema,
])

export const fileManageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/file/manage',
  query: fileManageQuerySchema,
  body: fileManageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

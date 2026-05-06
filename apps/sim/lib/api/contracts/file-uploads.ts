import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const fileUploadTypeSchema = z.enum([
  'knowledge-base',
  'chat',
  'copilot',
  'profile-pictures',
])

export const fileUploadTypeQuerySchema = z.object({
  type: fileUploadTypeSchema,
})

export const presignedUploadBodySchema = z
  .object({
    fileName: z.string().optional(),
    contentType: z.string().optional(),
    fileSize: z.number().optional(),
    userId: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough()

export const batchPresignedUploadBodySchema = z
  .object({
    files: z
      .array(
        z
          .object({
            fileName: z.string().optional(),
            contentType: z.string().optional(),
            fileSize: z.number().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough()

export const presignedFileInfoSchema = z
  .object({
    path: z.string(),
    key: z.string(),
    name: z.string(),
    size: z.number(),
    type: z.string(),
  })
  .passthrough()

export const presignedUploadResponseSchema = z
  .object({
    fileName: z.string(),
    presignedUrl: z.string(),
    fileInfo: presignedFileInfoSchema,
    uploadHeaders: z.record(z.string(), z.string()).optional(),
    directUploadSupported: z.boolean(),
  })
  .passthrough()

export const batchPresignedUploadResponseSchema = z
  .object({
    files: z.array(presignedUploadResponseSchema),
    directUploadSupported: z.boolean(),
  })
  .passthrough()

export const createPresignedUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/presigned',
  query: fileUploadTypeQuerySchema,
  body: presignedUploadBodySchema,
  response: {
    mode: 'json',
    schema: presignedUploadResponseSchema,
  },
})

export const createBatchPresignedUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/presigned/batch',
  query: fileUploadTypeQuerySchema,
  body: batchPresignedUploadBodySchema,
  response: {
    mode: 'json',
    schema: batchPresignedUploadResponseSchema,
  },
})

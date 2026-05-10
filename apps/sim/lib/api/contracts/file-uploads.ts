import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const fileUploadTypeSchema = z.enum(['knowledge-base', 'chat', 'copilot', 'profile-pictures'])

const fileUploadTypeQuerySchema = z.object({
  type: fileUploadTypeSchema,
})

const presignedUploadBodySchema = z
  .object({
    fileName: z.string().optional(),
    contentType: z.string().optional(),
    fileSize: z.number().optional(),
    userId: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough()

const batchPresignedUploadBodySchema = z
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

const presignedFileInfoSchema = z
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

const createPresignedUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/presigned',
  query: fileUploadTypeQuerySchema,
  body: presignedUploadBodySchema,
  response: {
    mode: 'json',
    schema: presignedUploadResponseSchema,
  },
})

const createBatchPresignedUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/presigned/batch',
  query: fileUploadTypeQuerySchema,
  body: batchPresignedUploadBodySchema,
  response: {
    mode: 'json',
    schema: batchPresignedUploadResponseSchema,
  },
})

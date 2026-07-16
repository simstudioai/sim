import { z } from 'zod'
import type { ContractBody, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const clickupUploadAttachmentBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  file: FileInputSchema,
})

const clickupAttachmentSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  extension: z.string().nullable(),
  url: z.string().nullable(),
  date: z.number().nullable(),
})

const clickupUserFileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    size: z.number(),
    type: z.string(),
    key: z.string(),
  })
  .passthrough()

const clickupUploadAttachmentResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    attachment: clickupAttachmentSchema,
    files: z.array(clickupUserFileSchema),
  }),
})

export const clickupUploadAttachmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/clickup/upload-attachment',
  body: clickupUploadAttachmentBodySchema,
  response: { mode: 'json', schema: clickupUploadAttachmentResponseSchema },
})

export type ClickUpUploadAttachmentBody = ContractBody<typeof clickupUploadAttachmentContract>
export type ClickUpUploadAttachmentApiResponse = ContractJsonResponse<
  typeof clickupUploadAttachmentContract
>

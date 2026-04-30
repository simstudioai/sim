import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const pipedriveDownloadedFileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  data: z.string(),
  size: z.number(),
})

export const pipedriveGetFilesResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    files: z.array(z.unknown()),
    downloadedFiles: z.array(pipedriveDownloadedFileSchema).optional(),
    total_items: z.number(),
    has_more: z.boolean(),
    next_start: z.number().nullable(),
    success: z.literal(true),
  }),
})

export const pipedriveGetFilesBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  sort: z.enum(['id', 'update_time']).optional().nullable(),
  limit: z.string().optional().nullable(),
  start: z.string().optional().nullable(),
  downloadFiles: z.boolean().optional().default(false),
})

export const pipedriveGetFilesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/pipedrive/get-files',
  body: pipedriveGetFilesBodySchema,
  response: { mode: 'json', schema: pipedriveGetFilesResponseSchema },
})

export type PipedriveGetFilesBody = ContractBody<typeof pipedriveGetFilesContract>
export type PipedriveGetFilesBodyInput = ContractBodyInput<typeof pipedriveGetFilesContract>
export type PipedriveGetFilesResponse = ContractJsonResponse<typeof pipedriveGetFilesContract>

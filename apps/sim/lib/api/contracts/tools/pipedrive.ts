import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const pipedriveToolResponseSchema = z.object({}).passthrough()

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
  response: { mode: 'json', schema: pipedriveToolResponseSchema },
})

export type PipedriveGetFilesBody = ContractBody<typeof pipedriveGetFilesContract>
export type PipedriveGetFilesBodyInput = ContractBodyInput<typeof pipedriveGetFilesContract>
export type PipedriveGetFilesResponse = ContractJsonResponse<typeof pipedriveGetFilesContract>

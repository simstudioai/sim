import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const zoomToolResponseSchema = z.object({}).passthrough()

export const zoomGetRecordingsBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  meetingId: z.string().min(1, 'Meeting ID is required'),
  includeFolderItems: z.boolean().optional(),
  ttl: z.number().optional(),
  downloadFiles: z.boolean().optional().default(false),
})

export const zoomGetRecordingsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/zoom/get-recordings',
  body: zoomGetRecordingsBodySchema,
  response: { mode: 'json', schema: zoomToolResponseSchema },
})

export type ZoomGetRecordingsBody = ContractBody<typeof zoomGetRecordingsContract>
export type ZoomGetRecordingsBodyInput = ContractBodyInput<typeof zoomGetRecordingsContract>
export type ZoomGetRecordingsResponse = ContractJsonResponse<typeof zoomGetRecordingsContract>

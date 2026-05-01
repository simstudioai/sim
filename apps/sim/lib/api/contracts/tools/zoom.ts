import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const zoomRecordingFileSchema = z.object({
  id: z.string().optional(),
  meeting_id: z.string().optional(),
  recording_start: z.string().optional(),
  recording_end: z.string().optional(),
  file_type: z.string().optional(),
  file_extension: z.string().optional(),
  file_size: z.number().optional(),
  play_url: z.string().optional(),
  download_url: z.string().optional(),
  status: z.string().optional(),
  recording_type: z.string().optional(),
})

const zoomDownloadedFileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  data: z.string(),
  size: z.number(),
})

export const zoomGetRecordingsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    recording: z.object({
      uuid: z.string().optional(),
      id: z.union([z.string(), z.number()]).optional(),
      account_id: z.string().optional(),
      host_id: z.string().optional(),
      topic: z.string().optional(),
      type: z.number().optional(),
      start_time: z.string().optional(),
      duration: z.number().optional(),
      total_size: z.number().optional(),
      recording_count: z.number().optional(),
      share_url: z.string().optional(),
      recording_files: z.array(zoomRecordingFileSchema),
    }),
    files: z.array(zoomDownloadedFileSchema).optional(),
  }),
})

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
  response: { mode: 'json', schema: zoomGetRecordingsResponseSchema },
})

export type ZoomGetRecordingsBody = ContractBody<typeof zoomGetRecordingsContract>
export type ZoomGetRecordingsBodyInput = ContractBodyInput<typeof zoomGetRecordingsContract>
export type ZoomGetRecordingsResponse = ContractJsonResponse<typeof zoomGetRecordingsContract>

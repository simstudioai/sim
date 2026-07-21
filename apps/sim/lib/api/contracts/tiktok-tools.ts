import { z } from 'zod'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const tiktokUploadVideoDraftBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  file: RawFileInputSchema,
})

export const tiktokUploadVideoDraftResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({ publishId: z.string() }).optional(),
  error: z.string().optional(),
})

export const tiktokUploadVideoDraftContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/tiktok/upload-video-draft',
  body: tiktokUploadVideoDraftBodySchema,
  response: { mode: 'json', schema: tiktokUploadVideoDraftResponseSchema },
})

export type TikTokUploadVideoDraftBody = ContractBodyInput<typeof tiktokUploadVideoDraftContract>
export type TikTokUploadVideoDraftResponse = ContractJsonResponse<
  typeof tiktokUploadVideoDraftContract
>

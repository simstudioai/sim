import { z } from 'zod'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const tiktokPublishVideoBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  file: RawFileInputSchema,
})

export const tiktokPublishVideoResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({ publishId: z.string() }).optional(),
  error: z.string().optional(),
})

export const tiktokPublishVideoContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/tiktok/publish-video',
  body: tiktokPublishVideoBodySchema,
  response: { mode: 'json', schema: tiktokPublishVideoResponseSchema },
})

export type TikTokPublishVideoBody = ContractBodyInput<typeof tiktokPublishVideoContract>
export type TikTokPublishVideoResponse = ContractJsonResponse<typeof tiktokPublishVideoContract>

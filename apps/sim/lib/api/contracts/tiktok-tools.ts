import { z } from 'zod'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const tiktokPublishVideoPostInfoSchema = z.object({
  title: z.string().optional(),
  privacy_level: z.string().optional(),
  disable_duet: z.boolean().optional(),
  disable_stitch: z.boolean().optional(),
  disable_comment: z.boolean().optional(),
  video_cover_timestamp_ms: z.number().optional(),
  is_aigc: z.boolean().optional(),
  brand_content_toggle: z.boolean().optional(),
  brand_organic_toggle: z.boolean().optional(),
})

export const tiktokPublishVideoBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  mode: z.enum(['direct', 'draft']),
  file: RawFileInputSchema,
  postInfo: tiktokPublishVideoPostInfoSchema.optional().nullable(),
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

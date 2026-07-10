import { z } from 'zod'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const tiktokPublishVideoPostInfoSchema = z.object({
  title: z.string().max(2200).optional(),
  privacy_level: z.enum([
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
  ]),
  disable_duet: z.boolean(),
  disable_stitch: z.boolean(),
  disable_comment: z.boolean(),
  video_cover_timestamp_ms: z.number().int().nonnegative().optional(),
  is_aigc: z.boolean().optional(),
  brand_content_toggle: z.boolean(),
  brand_organic_toggle: z.boolean().optional(),
})

const tiktokPublishVideoBaseSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  file: RawFileInputSchema,
})

export const tiktokPublishVideoBodySchema = z.discriminatedUnion('mode', [
  tiktokPublishVideoBaseSchema.extend({
    mode: z.literal('direct'),
    postInfo: tiktokPublishVideoPostInfoSchema,
    musicUsageConsent: z.literal('accepted'),
  }),
  tiktokPublishVideoBaseSchema.extend({
    mode: z.literal('draft'),
  }),
])

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

import { z } from 'zod'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  FileInputSchema,
  RawFileInputArraySchema,
  RawFileInputSchema,
} from '@/lib/uploads/utils/file-schemas'

export const instagramAccessTokenSchema = z.string().min(1, 'Access token is required')

/** Single media: uploaded file object or public HTTPS URL string. */
export const instagramMediaInputSchema = FileInputSchema

/**
 * Carousel media: file array, single file, or legacy comma-separated URL string
 * (optional `video:` prefix per entry).
 */
export const instagramCarouselMediaSchema = z.union([
  RawFileInputArraySchema,
  RawFileInputSchema,
  z.string().min(1, 'Carousel media is required'),
])

export const instagramPublishImageBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: z.string().optional().nullable(),
  image: instagramMediaInputSchema,
  caption: z.string().optional().nullable(),
  altText: z.string().optional().nullable(),
  isAiGenerated: z.boolean().optional().nullable(),
})

export const instagramPublishVideoBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: z.string().optional().nullable(),
  video: instagramMediaInputSchema,
  cover: instagramMediaInputSchema.optional().nullable(),
  caption: z.string().optional().nullable(),
})

export const instagramPublishReelBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: z.string().optional().nullable(),
  video: instagramMediaInputSchema,
  cover: instagramMediaInputSchema.optional().nullable(),
  caption: z.string().optional().nullable(),
  shareToFeed: z.boolean().optional().nullable(),
  thumbOffset: z.number().optional().nullable(),
})

export const instagramPublishStoryBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: z.string().optional().nullable(),
  media: instagramMediaInputSchema,
})

export const instagramPublishCarouselBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: z.string().optional().nullable(),
  media: instagramCarouselMediaSchema,
  caption: z.string().optional().nullable(),
})

export const instagramPublishImageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/instagram/publish-image',
  body: instagramPublishImageBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})

export const instagramPublishVideoContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/instagram/publish-video',
  body: instagramPublishVideoBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})

export const instagramPublishReelContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/instagram/publish-reel',
  body: instagramPublishReelBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})

export const instagramPublishStoryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/instagram/publish-story',
  body: instagramPublishStoryBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})

export const instagramPublishCarouselContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/instagram/publish-carousel',
  body: instagramPublishCarouselBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})

export type InstagramPublishImageBody = ContractBodyInput<typeof instagramPublishImageContract>
export type InstagramPublishVideoBody = ContractBodyInput<typeof instagramPublishVideoContract>
export type InstagramPublishReelBody = ContractBodyInput<typeof instagramPublishReelContract>
export type InstagramPublishStoryBody = ContractBodyInput<typeof instagramPublishStoryContract>
export type InstagramPublishCarouselBody = ContractBodyInput<
  typeof instagramPublishCarouselContract
>

export type InstagramPublishImageResponse = ContractJsonResponse<
  typeof instagramPublishImageContract
>
export type InstagramPublishVideoResponse = ContractJsonResponse<
  typeof instagramPublishVideoContract
>
export type InstagramPublishReelResponse = ContractJsonResponse<typeof instagramPublishReelContract>
export type InstagramPublishStoryResponse = ContractJsonResponse<
  typeof instagramPublishStoryContract
>
export type InstagramPublishCarouselResponse = ContractJsonResponse<
  typeof instagramPublishCarouselContract
>

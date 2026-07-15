import { z } from 'zod'
import {
  nonEmptyIdSchema,
  userFileSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const MAX_ACCESS_TOKEN_LENGTH = 8192
const MAX_GRAPH_ID_LENGTH = 256
const MAX_MEDIA_URL_LENGTH = 8192
const MAX_CAROUSEL_INPUT_LENGTH = 100_000
const MAX_CAPTION_LENGTH = 2200
const MAX_ALT_TEXT_LENGTH = 1000

const instagramOptionalUserIdSchema = z
  .string()
  .trim()
  .max(MAX_GRAPH_ID_LENGTH, 'Instagram user ID is too long')
  .optional()
  .nullable()

const instagramOptionalCaptionSchema = z
  .string()
  .max(MAX_CAPTION_LENGTH, `Caption cannot exceed ${MAX_CAPTION_LENGTH} characters`)
  .optional()
  .nullable()

function getCarouselItemCount(value: string): number | null {
  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.length : 1
    } catch {
      return null
    }
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean).length
}

export const instagramAccessTokenSchema = z
  .string()
  .min(1, 'Access token is required')
  .max(MAX_ACCESS_TOKEN_LENGTH, 'Access token is too long')

export const instagramDownloadMediaBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  mediaId: z.string().trim().min(1, 'Media ID is required').max(256, 'Media ID is too long'),
  filename: z
    .string()
    .trim()
    .min(1, 'Filename cannot be empty')
    .max(180, 'Filename is too long')
    .optional(),
  workspaceId: workspaceIdSchema.optional(),
  workflowId: workflowIdSchema.optional(),
  executionId: nonEmptyIdSchema.optional(),
})

export const instagramDownloadMediaOutputSchema = z
  .object({
    files: z.array(userFileSchema).min(1, 'At least one downloaded file is required').max(10),
    mediaId: z.string().min(1).max(MAX_GRAPH_ID_LENGTH),
    mediaType: z.string().max(64).nullable(),
    downloadedCount: z.number().int().min(1).max(10),
  })
  .superRefine((output, context) => {
    if (output.downloadedCount !== output.files.length) {
      context.addIssue({
        code: 'custom',
        path: ['downloadedCount'],
        message: 'Downloaded count must match the number of files',
      })
    }
  })

export const instagramDownloadMediaResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    output: instagramDownloadMediaOutputSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string().min(1),
  }),
])

/** Single media: uploaded file object or public HTTPS URL string. */
export const instagramMediaInputSchema = z.union([
  RawFileInputSchema,
  z.string().trim().min(1, 'Media is required').max(MAX_MEDIA_URL_LENGTH, 'Media URL is too long'),
])

/**
 * Carousel media: 2-10 files or a legacy comma-separated URL string
 * (optional `video:` prefix per entry).
 */
export const instagramCarouselMediaSchema = z.union([
  RawFileInputArraySchema.min(2, 'Carousels require at least 2 items').max(
    10,
    'Carousels support at most 10 items'
  ),
  z
    .string()
    .trim()
    .min(1, 'Carousel media is required')
    .max(MAX_CAROUSEL_INPUT_LENGTH, 'Carousel media input is too long')
    .refine(
      (value) => {
        const itemCount = getCarouselItemCount(value)
        return itemCount !== null && itemCount >= 2 && itemCount <= 10
      },
      { message: 'Carousels require between 2 and 10 items' }
    ),
])

export const instagramPublishImageBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: instagramOptionalUserIdSchema,
  image: instagramMediaInputSchema,
  caption: instagramOptionalCaptionSchema,
  altText: z
    .string()
    .max(MAX_ALT_TEXT_LENGTH, `Alt text cannot exceed ${MAX_ALT_TEXT_LENGTH} characters`)
    .optional()
    .nullable(),
  isAiGenerated: z.boolean().optional().nullable(),
})

export const instagramPublishVideoBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: instagramOptionalUserIdSchema,
  video: instagramMediaInputSchema,
  cover: instagramMediaInputSchema.optional().nullable(),
  caption: instagramOptionalCaptionSchema,
})

export const instagramPublishReelBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: instagramOptionalUserIdSchema,
  video: instagramMediaInputSchema,
  cover: instagramMediaInputSchema.optional().nullable(),
  caption: instagramOptionalCaptionSchema,
  shareToFeed: z.boolean().optional().nullable(),
  thumbOffset: z.number().optional().nullable(),
})

export const instagramPublishStoryBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: instagramOptionalUserIdSchema,
  media: instagramMediaInputSchema,
})

export const instagramPublishCarouselBodySchema = z.object({
  accessToken: instagramAccessTokenSchema,
  igUserId: instagramOptionalUserIdSchema,
  media: instagramCarouselMediaSchema,
  caption: instagramOptionalCaptionSchema,
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

export const instagramDownloadMediaContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/instagram/download-media',
  body: instagramDownloadMediaBodySchema,
  response: { mode: 'json', schema: instagramDownloadMediaResponseSchema },
})

export type InstagramDownloadMediaBody = ContractBodyInput<typeof instagramDownloadMediaContract>
export type InstagramDownloadMediaRouteResponse = ContractJsonResponse<
  typeof instagramDownloadMediaContract
>

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

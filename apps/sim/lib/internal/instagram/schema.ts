import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { RawFileInputArraySchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const MAX_ACCESS_TOKEN_LENGTH = 8192
const MAX_GRAPH_ID_LENGTH = 256
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

/** Canonical Sim file uploaded in basic mode or referenced from a prior block. */
export const instagramMediaInputSchema = RawFileInputSchema

/** Canonical Sim files uploaded in basic mode or referenced from prior blocks. */
export const instagramCarouselMediaSchema = RawFileInputArraySchema.min(
  2,
  'Carousels require at least 2 items'
).max(10, 'Carousels support at most 10 items')

export const instagramPublishOutputSchema = z.object({
  containerId: z.string().min(1, 'Container ID is required'),
  mediaId: z.string().min(1, 'Media ID is required'),
  statusCode: z.string().min(1, 'Status code is required'),
})

const instagramFailedPublishOutputSchema = z.object({
  containerId: z.null(),
  mediaId: z.null(),
  statusCode: z.null(),
})

export const instagramPublishResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    output: instagramPublishOutputSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string().min(1),
    output: instagramFailedPublishOutputSchema.optional(),
  }),
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

export type InstagramDownloadMediaBody = z.output<typeof instagramDownloadMediaBodySchema>
export type InstagramDownloadMediaRouteResponse = z.output<
  typeof instagramDownloadMediaResponseSchema
>
export type InstagramPublishImageBody = z.output<typeof instagramPublishImageBodySchema>
export type InstagramPublishVideoBody = z.output<typeof instagramPublishVideoBodySchema>
export type InstagramPublishReelBody = z.output<typeof instagramPublishReelBodySchema>
export type InstagramPublishStoryBody = z.output<typeof instagramPublishStoryBodySchema>
export type InstagramPublishCarouselBody = z.output<typeof instagramPublishCarouselBodySchema>
export type InstagramPublishImageResponse = z.output<typeof instagramPublishResponseSchema>
export type InstagramPublishVideoResponse = z.output<typeof instagramPublishResponseSchema>
export type InstagramPublishReelResponse = z.output<typeof instagramPublishResponseSchema>
export type InstagramPublishStoryResponse = z.output<typeof instagramPublishResponseSchema>
export type InstagramPublishCarouselResponse = z.output<typeof instagramPublishResponseSchema>

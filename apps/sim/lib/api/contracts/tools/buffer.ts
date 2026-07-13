import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

/**
 * Internal contracts for the Buffer create-post / edit-post routes. The Buffer
 * GraphQL API attaches media by publicly accessible URL only, so the tools post
 * a JSON envelope to these internal routes, which verify access to any
 * referenced file, mint a short-lived presigned URL for it, and forward the
 * mutation to Buffer.
 */

const postErrorSchema = z.object({
  message: z.string(),
  supportUrl: z.string().nullable(),
  rawError: z.string().nullable(),
})

const postAssetSchema = z.object({
  id: z.string().nullable(),
  type: z.string(),
  mimeType: z.string(),
  source: z.string(),
  thumbnail: z.string(),
})

const postSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: z.string(),
  via: z.string(),
  channelId: z.string(),
  channelService: z.string(),
  schedulingType: z.string().nullable(),
  shareMode: z.string(),
  isCustomScheduled: z.boolean(),
  sharedNow: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  dueAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  externalLink: z.string().nullable(),
  error: postErrorSchema.nullable(),
  assets: z.array(postAssetSchema),
})

const postRouteResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({ post: postSchema }).optional(),
  error: z.string().optional(),
})

const postSharedFields = {
  apiKey: z.string().min(1, 'API key is required'),
  text: z.string().max(50000, 'text is too long').optional().nullable(),
  mode: z.enum(['addToQueue', 'shareNext', 'shareNow', 'customScheduled']),
  schedulingType: z.enum(['automatic', 'notification']).default('automatic'),
  dueAt: z
    .string()
    .datetime({ offset: true, message: 'dueAt must be an ISO 8601 timestamp' })
    .optional()
    .nullable(),
  saveToDraft: z.boolean().optional().nullable(),
  media: FileInputSchema.optional().nullable(),
  mediaAltText: z.string().max(1000, 'mediaAltText is too long').optional().nullable(),
}

/**
 * Cross-field rule shared by create and edit: a custom-scheduled post needs a
 * publish time.
 */
function validateDueAt(body: { mode: string; dueAt?: string | null }, ctx: z.RefinementCtx): void {
  if (body.mode === 'customScheduled' && !body.dueAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dueAt'],
      message: 'dueAt is required when mode is customScheduled',
    })
  }
}

export const bufferCreatePostBodySchema = z
  .object({
    ...postSharedFields,
    channelId: z.string().min(1, 'channelId is required'),
  })
  .superRefine((body, ctx) => {
    validateDueAt(body, ctx)
    if (!body.text?.trim() && !body.media) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Either text or media is required',
      })
    }
  })

export type BufferCreatePostBody = z.input<typeof bufferCreatePostBodySchema>

export const bufferCreatePostContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/buffer/create-post',
  body: bufferCreatePostBodySchema,
  response: { mode: 'json', schema: postRouteResponseSchema },
})

export const bufferEditPostBodySchema = z
  .object({
    ...postSharedFields,
    postId: z.string().min(1, 'postId is required'),
  })
  .superRefine(validateDueAt)

export type BufferEditPostBody = z.input<typeof bufferEditPostBodySchema>

export const bufferEditPostContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/buffer/edit-post',
  body: bufferEditPostBodySchema,
  response: { mode: 'json', schema: postRouteResponseSchema },
})

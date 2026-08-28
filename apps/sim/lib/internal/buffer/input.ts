import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const sharedFields = {
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
  mediaType: z.enum(['auto', 'image', 'video']).default('auto'),
  mediaAltText: z.string().max(1000, 'mediaAltText is too long').optional().nullable(),
}

function validateDueAt(body: { mode: string; dueAt?: string | null }, ctx: z.RefinementCtx): void {
  if (body.mode === 'customScheduled' && !body.dueAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dueAt'],
      message: 'dueAt is required when mode is customScheduled',
    })
  }
}

export const bufferCreatePostInputSchema = z
  .object({
    ...sharedFields,
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

export const bufferEditPostInputSchema = z
  .object({
    ...sharedFields,
    postId: z.string().min(1, 'postId is required'),
  })
  .superRefine(validateDueAt)

export type BufferCreatePostInput = z.output<typeof bufferCreatePostInputSchema>
export type BufferEditPostInput = z.output<typeof bufferEditPostInputSchema>

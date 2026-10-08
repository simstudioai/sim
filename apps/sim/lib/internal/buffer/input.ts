import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { parseBufferInput } from '@/tools/buffer/schema'

function structuredInput(type: string) {
  return z.unknown().transform((value, ctx) => {
    try {
      return parseBufferInput(type, value)
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid Buffer ${type}` })
      return z.NEVER
    }
  })
}

const assetsInput = z.unknown().transform((value, ctx) => {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed) || parsed.length > 1000) throw new Error('Invalid assets')
    return parsed.map((asset) => parseBufferInput('AssetInput', asset))
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Buffer assets' })
    return z.NEVER
  }
})

const sharedFields = {
  apiKey: z.string().min(1, 'API key is required'),
  text: z.string().max(50000, 'text is too long').optional().nullable(),
  dueAt: z
    .string()
    .datetime({ offset: true, message: 'dueAt must be an ISO 8601 timestamp' })
    .optional()
    .nullable(),
  saveToDraft: z.boolean().optional().nullable(),
  media: FileInputSchema.optional().nullable(),
  mediaType: z.enum(['auto', 'image', 'video']).default('auto'),
  mediaAltText: z.string().max(1000, 'mediaAltText is too long').optional().nullable(),
  assets: assetsInput.optional().nullable(),
  metadata: structuredInput('PostInputMetaData').optional().nullable(),
  aiAssisted: z.boolean().optional().nullable(),
  draftId: z.string().optional().nullable(),
  ideaId: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  tagIds: z.array(z.string()).max(1000).optional().nullable(),
}

function validateDueAt(
  body: { mode?: string | null; dueAt?: string | null; media?: unknown; assets?: unknown },
  ctx: z.RefinementCtx
): void {
  if (body.mode === 'customScheduled' && !body.dueAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dueAt'],
      message: 'dueAt is required when mode is customScheduled',
    })
  }
  if (body.media != null && body.assets !== undefined)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assets'],
      message: 'Choose media or assets, not both',
    })
}

export const bufferCreatePostInputSchema = z
  .object({
    ...sharedFields,
    assets: sharedFields.assets.transform((assets) => assets ?? undefined),
    channelId: z.string().min(1, 'channelId is required'),
    mode: z.enum(['addToQueue', 'shareNext', 'shareNow', 'customScheduled']),
    schedulingType: z.enum(['automatic', 'notification']).default('automatic'),
    needsApproval: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    validateDueAt(body, ctx)
    if (!body.text?.trim() && !body.media && !body.assets?.length && !body.metadata) {
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
    mode: z.enum(['addToQueue', 'shareNext', 'shareNow', 'customScheduled']).optional().nullable(),
    schedulingType: z.enum(['automatic', 'notification']).optional().nullable(),
    approvalChange: z.enum(['request', 'revert']).optional().nullable(),
  })
  .superRefine(validateDueAt)

export type BufferCreatePostInput = z.output<typeof bufferCreatePostInputSchema>
export type BufferEditPostInput = z.output<typeof bufferEditPostInputSchema>

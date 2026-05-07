import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const videoProviders = ['runway', 'veo', 'luma', 'minimax', 'falai'] as const
const MISSING_VIDEO_FIELDS_ERROR = 'Missing required fields: provider, apiKey, and prompt'

export const videoToolBodySchema = z
  .object({
    provider: z
      .string({ error: MISSING_VIDEO_FIELDS_ERROR })
      .min(1, MISSING_VIDEO_FIELDS_ERROR)
      .refine((provider) => videoProviders.includes(provider as (typeof videoProviders)[number]), {
        message: `Invalid provider. Must be one of: ${videoProviders.join(', ')}`,
      }),
    apiKey: z.string({ error: MISSING_VIDEO_FIELDS_ERROR }).min(1, MISSING_VIDEO_FIELDS_ERROR),
    model: z.string().optional(),
    prompt: z.string({ error: MISSING_VIDEO_FIELDS_ERROR }).min(1, MISSING_VIDEO_FIELDS_ERROR),
    duration: z.coerce.number().optional(),
    aspectRatio: z.string().optional(),
    resolution: z.string().optional(),
    visualReference: userFileSchema.optional(),
    cameraControl: z.unknown().optional(),
    endpoint: z.string().optional(),
    promptOptimizer: z.boolean().optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
    userId: z.string().optional(),
  })
  .passthrough()

export const videoToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/video',
  body: videoToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

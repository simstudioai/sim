import { z } from 'zod'
import { toolBooleanSchema, toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const imageProviders = ['openai', 'gemini', 'falai'] as const
const MISSING_IMAGE_FIELDS_ERROR = 'Missing required fields: provider, apiKey, and prompt'

export const imageProxyQuerySchema = z.object({
  url: z.string({ error: 'Missing URL parameter' }).min(1, 'Missing URL parameter'),
})

export const imageToolBodySchema = z
  .object({
    provider: z
      .string({ error: MISSING_IMAGE_FIELDS_ERROR })
      .min(1, MISSING_IMAGE_FIELDS_ERROR)
      .refine((provider) => imageProviders.includes(provider as (typeof imageProviders)[number]), {
        message: `Invalid provider. Must be one of: ${imageProviders.join(', ')}`,
      }),
    apiKey: z.string({ error: MISSING_IMAGE_FIELDS_ERROR }).min(1, MISSING_IMAGE_FIELDS_ERROR),
    model: z.string().optional(),
    prompt: z.string({ error: MISSING_IMAGE_FIELDS_ERROR }).min(1, MISSING_IMAGE_FIELDS_ERROR),
    size: z.string().optional(),
    aspectRatio: z.string().optional(),
    resolution: z.string().optional(),
    quality: z.string().optional(),
    background: z.string().optional(),
    outputFormat: z.string().optional(),
    moderation: z.string().optional(),
    safetyTolerance: z.string().optional(),
    numImages: z.coerce.number().int().optional(),
    seed: z.coerce.number().int().optional(),
    enableSafetyChecker: toolBooleanSchema.optional(),
    enableWebSearch: toolBooleanSchema.optional(),
    thinkingLevel: z.string().optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
    userId: z.string().optional(),
    useHostedCostTracking: z.boolean().optional(),
  })
  .passthrough()

export type ImageToolBody = z.infer<typeof imageToolBodySchema>

export const imageProxyContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/image',
  query: imageProxyQuerySchema,
  response: { mode: 'binary' },
})

export const imageToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/image',
  body: imageToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

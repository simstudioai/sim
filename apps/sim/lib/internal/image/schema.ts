import { z } from 'zod'

export const imageProviders = ['openai', 'gemini', 'falai'] as const
const MISSING_IMAGE_FIELDS_ERROR = 'Missing required fields: provider, apiKey, and prompt'
const optionalNumberInput = (value: unknown) =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value
const booleanInputSchema = z.preprocess(
  (value) => {
    if (typeof value === 'boolean') return value
    if (typeof value !== 'string') return value
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0' || normalized === '') return false
    return value
  },
  z.boolean({ error: 'must be a boolean (true/false)' })
)

export const imageGenerationInputSchema = z
  .object({
    provider: z
      .string({ error: MISSING_IMAGE_FIELDS_ERROR })
      .min(1, MISSING_IMAGE_FIELDS_ERROR)
      .refine((provider) => imageProviders.includes(provider as ImageProvider), {
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
    numImages: z.preprocess(optionalNumberInput, z.coerce.number().int().min(1).max(6).optional()),
    seed: z.preprocess(optionalNumberInput, z.coerce.number().int().optional()),
    enableSafetyChecker: booleanInputSchema.optional(),
    enableWebSearch: booleanInputSchema.optional(),
    thinkingLevel: z.string().optional(),
    useHostedCostTracking: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((input, context) => {
    if (input.provider === 'openai' && input.numImages !== undefined && input.numImages !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['numImages'],
        message: 'OpenAI image generation returns one image per tool execution',
      })
    }
  })

export type ImageGenerationInput = z.output<typeof imageGenerationInputSchema>
export type ImageProvider = (typeof imageProviders)[number]

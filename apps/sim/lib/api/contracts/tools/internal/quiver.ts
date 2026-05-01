import { z } from 'zod'
import { internalToolResponseSchema } from '@/lib/api/contracts/tools/internal/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const quiverCommonBodySchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional().nullable(),
  top_p: z.number().min(0).max(1).optional().nullable(),
  max_output_tokens: z.number().int().min(1).max(131072).optional().nullable(),
  presence_penalty: z.number().min(-2).max(2).optional().nullable(),
})

export const quiverTextToSvgBodySchema = quiverCommonBodySchema.extend({
  prompt: z.string().min(1),
  instructions: z.string().optional().nullable(),
  references: z
    .union([z.array(FileInputSchema), FileInputSchema, z.string()])
    .optional()
    .nullable(),
  n: z.number().int().min(1).max(16).optional().nullable(),
})

export const quiverImageToSvgBodySchema = quiverCommonBodySchema.extend({
  image: z.union([FileInputSchema, z.string()]),
  auto_crop: z.boolean().optional().nullable(),
  target_size: z.number().int().min(128).max(4096).optional().nullable(),
})

export const quiverTextToSvgContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quiver/text-to-svg',
  body: quiverTextToSvgBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const quiverImageToSvgContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quiver/image-to-svg',
  body: quiverImageToSvgBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

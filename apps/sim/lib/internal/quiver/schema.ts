import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const quiverCommonInputSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional().nullable(),
  top_p: z.number().min(0).max(1).optional().nullable(),
  max_output_tokens: z.number().int().min(1).max(131072).optional().nullable(),
  presence_penalty: z.number().min(-2).max(2).optional().nullable(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export const quiverTextToSvgInputSchema = quiverCommonInputSchema.extend({
  prompt: z.string().min(1),
  instructions: z.string().optional().nullable(),
  references: z
    .union([z.array(FileInputSchema), FileInputSchema, z.string()])
    .optional()
    .nullable(),
  n: z.number().int().min(1).max(16).optional().nullable(),
})

export const quiverImageToSvgInputSchema = quiverCommonInputSchema.extend({
  image: z.union([FileInputSchema, z.string()]),
  auto_crop: z.boolean().optional().nullable(),
  target_size: z.number().int().min(128).max(4096).optional().nullable(),
})

export type QuiverTextToSvgInput = z.output<typeof quiverTextToSvgInputSchema>
export type QuiverImageToSvgInput = z.output<typeof quiverImageToSvgInputSchema>

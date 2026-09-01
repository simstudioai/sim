import { z } from 'zod'

export const MAX_ENRICHMENT_INPUT_FIELDS = 100

export const enrichmentInputSchema = z.object({
  enrichmentId: z.string().min(1, 'enrichmentId is required'),
  inputs: z
    .record(z.string(), z.unknown())
    .default({})
    .refine(
      (inputs) => Object.keys(inputs).length <= MAX_ENRICHMENT_INPUT_FIELDS,
      `inputs cannot exceed ${MAX_ENRICHMENT_INPUT_FIELDS} fields`
    ),
})

export type EnrichmentInput = z.output<typeof enrichmentInputSchema>

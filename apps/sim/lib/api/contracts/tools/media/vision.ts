import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const visionAnalyzeBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  imageUrl: z.string().optional().nullable(),
  imageFile: RawFileInputSchema.optional().nullable(),
  model: z.string().optional().default('gpt-5.2'),
  prompt: z.string().optional().nullable(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export const visionAnalyzeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/vision/analyze',
  body: visionAnalyzeBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

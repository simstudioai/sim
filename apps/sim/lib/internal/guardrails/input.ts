import { z } from 'zod'
import {
  customPatternSchema,
  resolvedSecretTraceProvenanceSchema,
} from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

export const guardrailsValidationInputSchema = z.object({
  validationType: z.string().optional(),
  input: z.unknown().optional(),
  regex: z.string().optional(),
  knowledgeBaseId: z.string().optional(),
  threshold: z.string().optional(),
  topK: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  azureEndpoint: z.string().optional(),
  azureApiVersion: z.string().optional(),
  vertexProject: z.string().optional(),
  vertexLocation: z.string().optional(),
  vertexCredential: z.string().optional(),
  bedrockAccessKeyId: z.string().optional(),
  bedrockSecretKey: z.string().optional(),
  bedrockRegion: z.string().optional(),
  workflowId: z.string().optional(),
  piiEntityTypes: z.array(z.string()).optional(),
  piiMode: z.string().optional(),
  piiLanguage: z.string().optional(),
  piiCustomPatterns: z.array(customPatternSchema).max(20).optional(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export type GuardrailsValidationInput = z.input<typeof guardrailsValidationInputSchema>

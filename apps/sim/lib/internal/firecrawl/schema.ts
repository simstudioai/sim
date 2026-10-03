import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const firecrawlParseInputSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  file: RawFileInputSchema,
  options: z.record(z.string(), z.unknown()).optional(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export type FirecrawlParseInput = z.output<typeof firecrawlParseInputSchema>

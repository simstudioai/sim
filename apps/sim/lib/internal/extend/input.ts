import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const extendParseInputSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  outputFormat: z.enum(['markdown', 'spatial']).optional(),
  chunking: z.enum(['page', 'document', 'section']).optional(),
  engine: z.enum(['parse_performance', 'parse_light']).optional(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export type ExtendParseInput = z.infer<typeof extendParseInputSchema>

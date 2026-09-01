import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const reductoParseInputSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  pages: z.array(z.number()).max(10_000).optional(),
  tableOutputFormat: z.enum(['html', 'md']).optional(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export type ReductoParseInput = z.infer<typeof reductoParseInputSchema>

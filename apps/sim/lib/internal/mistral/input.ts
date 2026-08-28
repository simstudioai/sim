import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { MISTRAL_OCR_REQUEST_POLICY } from '@/lib/knowledge/documents/ocr-request-policy'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const mistralParseInputSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().min(1, 'File path is required').optional(),
  fileData: FileInputSchema.optional(),
  file: FileInputSchema.optional(),
  resultType: z.string().optional(),
  pages: z.array(z.number()).max(MISTRAL_OCR_REQUEST_POLICY.maxPages).optional(),
  includeImageBase64: z.boolean().optional(),
  imageLimit: z.number().optional(),
  imageMinSize: z.number().optional(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export type MistralParseInput = z.infer<typeof mistralParseInputSchema>

export const MISTRAL_MAX_OPERATION_INPUT_BYTES =
  Math.ceil(MISTRAL_OCR_REQUEST_POLICY.maxBytes / 3) * 4 + 1024 * 1024

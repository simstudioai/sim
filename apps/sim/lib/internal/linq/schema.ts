import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const linqCreateAttachmentInputSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
  filename: z.string().min(1).max(1024).optional().nullable(),
  contentType: z.string().min(1).max(255).optional().nullable(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export type LinqCreateAttachmentInput = z.output<typeof linqCreateAttachmentInputSchema>

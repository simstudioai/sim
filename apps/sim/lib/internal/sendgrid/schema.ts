import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

export const sendGridSendInputSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  from: z.string().min(1, 'From email is required'),
  fromName: z.string().optional().nullable(),
  to: z.string().min(1, 'To email is required'),
  toName: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  contentType: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  replyTo: z.string().optional().nullable(),
  replyToName: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
  dynamicTemplateData: z.unknown().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export type SendGridSendInput = z.output<typeof sendGridSendInputSchema>

import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const servicenowUploadAttachmentBodySchema = z.object({
  instanceUrl: z.string().min(1, 'Instance URL is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  tableName: z.string().min(1, 'Table name is required'),
  recordSysId: z.string().min(1, 'Record sys_id is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
})

export type ServiceNowUploadAttachmentBody = z.input<typeof servicenowUploadAttachmentBodySchema>

// untyped-response: ServiceNow returns arbitrary attachment metadata wrapped in a success envelope
const servicenowToolResponseSchema = z.unknown()

export const servicenowUploadAttachmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/servicenow/upload-attachment',
  body: servicenowUploadAttachmentBodySchema,
  response: { mode: 'json', schema: servicenowToolResponseSchema },
})

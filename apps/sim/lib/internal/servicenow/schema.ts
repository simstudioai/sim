import { z } from 'zod'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const serviceNowUploadAttachmentInputSchema = z.object({
  instanceUrl: z.string().min(1, 'Instance URL is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  tableName: z.string().min(1, 'Table name is required'),
  recordSysId: z.string().min(1, 'Record sys_id is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
})

export type ServiceNowUploadAttachmentInput = z.output<typeof serviceNowUploadAttachmentInputSchema>

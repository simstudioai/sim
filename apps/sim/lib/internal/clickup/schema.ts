import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const clickupUploadAttachmentInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  file: FileInputSchema,
})

export type ClickUpUploadAttachmentInput = z.output<typeof clickupUploadAttachmentInputSchema>

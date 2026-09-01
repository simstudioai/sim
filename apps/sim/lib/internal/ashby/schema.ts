import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const ashbyUploadInputSchema = z.object({
  apiKey: z.string().min(1, 'Ashby API key is required'),
  candidateId: z.string().min(1, 'Candidate ID is required'),
  file: FileInputSchema,
  fileName: z.string().optional().nullable(),
  onBehalfOfUserId: z.string().optional().nullable(),
})

export type AshbyUploadInput = z.output<typeof ashbyUploadInputSchema>

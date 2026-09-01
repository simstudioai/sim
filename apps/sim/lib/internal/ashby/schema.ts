import { z } from 'zod'
import { FileInputSchema, parseRawFileInput } from '@/lib/uploads/utils/file-schemas'

export const ashbyUploadInputSchema = z.object({
  apiKey: z.string().min(1, 'Ashby API key is required'),
  candidateId: z.string().trim().min(1, 'Candidate ID is required'),
  file: FileInputSchema.transform((value, context) => {
    const parsed = parseRawFileInput(value)
    if (parsed) return parsed
    context.addIssue({ code: 'custom', message: 'File must reference an uploaded file' })
    return z.NEVER
  }),
  fileName: z.string().optional().nullable(),
  onBehalfOfUserId: z.string().optional().nullable(),
})

export type AshbyUploadInput = z.output<typeof ashbyUploadInputSchema>

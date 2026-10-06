import { z } from 'zod'
import { FileInputSchema, parseRawFileInput } from '@/lib/uploads/utils/file-schemas'

export const planeUploadAttachmentInputSchema = z.object({
  apiKey: z.string().trim().min(1, 'Plane API key is required'),
  baseUrl: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  workspaceSlug: z.string().trim().min(1, 'Workspace slug is required'),
  projectId: z.string().trim().min(1, 'Project ID is required'),
  workItemId: z.string().trim().min(1, 'Work item ID is required'),
  file: FileInputSchema.transform((value, context) => {
    const parsed = parseRawFileInput(value)
    if (parsed) return parsed
    context.addIssue({ code: 'custom', message: 'File must reference an uploaded file' })
    return z.NEVER
  }),
})

export type PlaneUploadAttachmentInput = z.output<typeof planeUploadAttachmentInputSchema>

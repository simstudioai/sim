import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const supabaseStorageUploadInputSchema = z.object({
  projectId: z
    .string()
    .min(1, 'Project ID is required')
    .regex(/^[a-z0-9]+$/, 'Project ID must contain only lowercase alphanumeric characters'),
  apiKey: z.string().min(1, 'API key is required'),
  bucket: z.string().min(1, 'Bucket name is required'),
  fileName: z.string().min(1, 'File name is required'),
  path: z.string().optional().nullable(),
  fileData: FileInputSchema,
  contentType: z.string().optional().nullable(),
  cacheControl: z.string().optional().nullable(),
  upsert: z.boolean().optional().default(false),
})

export type SupabaseStorageUploadInput = z.output<typeof supabaseStorageUploadInputSchema>

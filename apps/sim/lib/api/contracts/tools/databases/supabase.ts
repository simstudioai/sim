import { z } from 'zod'
import { supabaseStorageUploadResponseSchema } from '@/lib/api/contracts/tools/databases/shared'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const supabaseStorageUploadBodySchema = z.object({
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
  upsert: z.boolean().optional().default(false),
})

export const supabaseStorageUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/supabase/storage-upload',
  body: supabaseStorageUploadBodySchema,
  response: { mode: 'json', schema: supabaseStorageUploadResponseSchema },
})

export type SupabaseStorageUploadRequest = ContractBodyInput<typeof supabaseStorageUploadContract>
export type SupabaseStorageUploadResponse = ContractJsonResponse<
  typeof supabaseStorageUploadContract
>

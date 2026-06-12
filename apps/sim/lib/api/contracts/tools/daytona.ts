import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const daytonaUploadFileBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  sandboxId: z.string().min(1, 'Sandbox ID is required'),
  destinationPath: z.string().min(1, 'Destination path is required'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z.string().nullish(),
  fileName: z.string().nullish(),
})

export const daytonaUploadFileResponseSchema = z.object({
  success: z.boolean(),
  uploadedPath: z.string().optional(),
  name: z.string().optional(),
  size: z.number().optional(),
  error: z.string().optional(),
})

export const daytonaUploadFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/daytona/upload',
  body: daytonaUploadFileBodySchema,
  response: { mode: 'json', schema: daytonaUploadFileResponseSchema },
})

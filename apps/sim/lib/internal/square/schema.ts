import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const squareCatalogImageInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  file: FileInputSchema,
  fileName: z.string().optional().nullable(),
  objectId: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
})

export type SquareCatalogImageInput = z.output<typeof squareCatalogImageInputSchema>

import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { SQUARE_ENVIRONMENTS } from '@/tools/square/types'

export const squareCatalogImageInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  environment: z
    .string()
    .refine((value) => SQUARE_ENVIRONMENTS.has(value), 'Unknown Square environment')
    .optional(),
  file: FileInputSchema,
  fileName: z.string().optional().nullable(),
  objectId: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
})

export type SquareCatalogImageInput = z.output<typeof squareCatalogImageInputSchema>

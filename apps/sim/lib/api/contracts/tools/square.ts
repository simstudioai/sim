import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

/**
 * Internal contract for the Square catalog image upload route. The route
 * downloads the referenced file from storage and forwards it to Square's
 * multipart `CreateCatalogImage` endpoint, returning the created image object.
 *
 * The `output.object` is a Square CatalogObject, whose shape is polymorphic by
 * `type`, so it is intentionally left opaque while the envelope is typed.
 */
const squareCatalogImageResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      object: z.unknown(),
      metadata: z.object({
        id: z.string(),
        type: z.string().nullable(),
        version: z.number().nullable(),
      }),
    })
    .optional(),
  error: z.string().optional(),
})

export const squareCatalogImageBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  file: FileInputSchema.optional().nullable(),
  fileName: z.string().optional().nullable(),
  objectId: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
})

export type SquareCatalogImageBody = z.input<typeof squareCatalogImageBodySchema>

export const squareCatalogImageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/square/catalog-image',
  body: squareCatalogImageBodySchema,
  response: { mode: 'json', schema: squareCatalogImageResponseSchema },
})

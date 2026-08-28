import { z } from 'zod'

export const neo4jEncryptionSchema = z.enum(['enabled', 'disabled']).default('disabled')

export const neo4jResponseSchema = z
  .object({
    message: z.string(),
  })
  .passthrough()

export const introspectionResponseSchema = z
  .object({
    message: z.string(),
  })
  .passthrough()

export const supabaseStorageUploadResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    message: z.string(),
    results: z.record(z.string(), z.unknown()),
  }),
})

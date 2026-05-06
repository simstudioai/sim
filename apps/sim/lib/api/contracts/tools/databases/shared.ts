import { z } from 'zod'

export const sslModeSchema = z.enum(['disabled', 'required', 'preferred']).default('preferred')
export const neo4jEncryptionSchema = z.enum(['enabled', 'disabled']).default('disabled')

export const nonEmptyRecordSchema = (message: string) =>
  z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, { message })

const jsonObjectStringSchema = (message: string, includeReceivedValue = false) =>
  z
    .string()
    .min(1)
    .transform((str) => {
      try {
        const parsed = JSON.parse(str)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Data must be a JSON object')
        }
        return parsed
      } catch (error) {
        if (!includeReceivedValue) {
          throw new Error(message)
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        throw new Error(`${message}: ${errorMessage}. Received: ${str.substring(0, 100)}...`)
      }
    })

export const sqlConnectionBodySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  ssl: sslModeSchema,
})

export const sqlQueryBodySchema = sqlConnectionBodySchema.extend({
  query: z.string().min(1, 'Query is required'),
})

const sqlInsertDataSchema = z.union([
  nonEmptyRecordSchema('Data object cannot be empty'),
  jsonObjectStringSchema('Invalid JSON format in data field', true),
])

const sqlUpdateDataSchema = z.union([
  nonEmptyRecordSchema('Data object cannot be empty'),
  jsonObjectStringSchema('Invalid JSON format in data field'),
])

export const sqlInsertBodySchema = sqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: sqlInsertDataSchema,
})

export const sqlUpdateBodySchema = sqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: sqlUpdateDataSchema,
  where: z.string().min(1, 'WHERE clause is required'),
})

export const sqlDeleteBodySchema = sqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  where: z.string().min(1, 'WHERE clause is required'),
})

export const sqlRowsResponseSchema = z.object({
  message: z.string(),
  rows: z.array(z.unknown()),
  rowCount: z.number(),
})

export const mongoDocumentsResponseSchema = z
  .object({
    message: z.string(),
    documents: z.array(z.unknown()).optional(),
    documentCount: z.number().optional(),
  })
  .passthrough()

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

export const redisExecuteResponseSchema = z.object({
  result: z.unknown(),
})

export const supabaseStorageUploadResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    message: z.string(),
    results: z.record(z.string(), z.unknown()),
  }),
})

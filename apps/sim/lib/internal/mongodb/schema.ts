import { z } from 'zod'

const sslModeSchema = z.enum(['disabled', 'required', 'preferred']).default('preferred')

const connectionInputSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required').optional(),
  password: z.string().min(1, 'Password is required').optional(),
  authSource: z.string().optional(),
  ssl: sslModeSchema,
})

const usernamePasswordPaired = (data: { username?: string; password?: string }) =>
  Boolean(data.username) === Boolean(data.password)

const usernamePasswordPairedError = {
  message: 'Username and password must be provided together',
  path: ['password' as const],
}

const jsonStringOrObjectSchema = (message: string) =>
  z
    .union([z.string(), z.object({}).passthrough()])
    .transform((value) =>
      typeof value === 'object' && value !== null ? JSON.stringify(value) : value
    )
    .refine((value) => value && value.trim() !== '', { message })

const booleanStringSchema = z
  .union([z.boolean(), z.string(), z.undefined()])
  .optional()
  .transform((value) => {
    if (value === 'true' || value === true) return true
    if (value === 'false' || value === false) return false
    return false
  })

export const mongodbQueryInputSchema = connectionInputSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    query: z
      .union([z.string(), z.object({}).passthrough()])
      .optional()
      .default('{}')
      .transform((value) => {
        if (typeof value === 'object' && value !== null) return JSON.stringify(value)
        return value || '{}'
      }),
    limit: z
      .union([z.coerce.number().int().positive(), z.literal(''), z.undefined()])
      .optional()
      .transform((value) => (value === '' || value === undefined || value === null ? 100 : value)),
    sort: z
      .union([z.string(), z.object({}).passthrough(), z.null()])
      .optional()
      .transform((value) =>
        typeof value === 'object' && value !== null ? JSON.stringify(value) : value
      ),
  })
  .refine(usernamePasswordPaired, usernamePasswordPairedError)

export const mongodbExecuteInputSchema = connectionInputSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    pipeline: z
      .union([z.string(), z.array(z.object({}).passthrough())])
      .transform((value) => (Array.isArray(value) ? JSON.stringify(value) : value))
      .refine((value) => value && value.trim() !== '', { message: 'Pipeline is required' }),
  })
  .refine(usernamePasswordPaired, usernamePasswordPairedError)

export const mongodbInsertInputSchema = connectionInputSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    documents: z
      .union([z.array(z.record(z.string(), z.unknown())), z.string()])
      .transform((value) => {
        if (typeof value !== 'string') return value
        try {
          const parsed: unknown = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : [parsed]
        } catch {
          throw new Error('Invalid JSON in documents field')
        }
      })
      .refine((value) => Array.isArray(value) && value.length > 0, {
        message: 'At least one document is required',
      }),
  })
  .refine(usernamePasswordPaired, usernamePasswordPairedError)

export const mongodbUpdateInputSchema = connectionInputSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    filter: jsonStringOrObjectSchema('Filter is required for MongoDB Update').refine(
      (value) => value !== '{}',
      { message: 'Filter is required for MongoDB Update' }
    ),
    update: jsonStringOrObjectSchema('Update is required'),
    upsert: booleanStringSchema,
    multi: booleanStringSchema,
  })
  .refine(usernamePasswordPaired, usernamePasswordPairedError)

export const mongodbDeleteInputSchema = connectionInputSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    filter: jsonStringOrObjectSchema('Filter is required for MongoDB Delete').refine(
      (value) => value !== '{}',
      { message: 'Filter is required for MongoDB Delete' }
    ),
    multi: booleanStringSchema,
  })
  .refine(usernamePasswordPaired, usernamePasswordPairedError)

export const mongodbIntrospectInputSchema = z
  .object({
    host: z.string().min(1, 'Host is required'),
    port: z.coerce.number().int().positive('Port must be a positive integer'),
    database: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    authSource: z.string().optional(),
    ssl: sslModeSchema,
  })
  .refine((data) => Boolean(data.username) === Boolean(data.password), {
    message: 'Username and password must be provided together',
    path: ['password'],
  })

export type MongodbQueryInput = z.output<typeof mongodbQueryInputSchema>
export type MongodbExecuteInput = z.output<typeof mongodbExecuteInputSchema>
export type MongodbInsertInput = z.output<typeof mongodbInsertInputSchema>
export type MongodbUpdateInput = z.output<typeof mongodbUpdateInputSchema>
export type MongodbDeleteInput = z.output<typeof mongodbDeleteInputSchema>
export type MongodbIntrospectInput = z.output<typeof mongodbIntrospectInputSchema>

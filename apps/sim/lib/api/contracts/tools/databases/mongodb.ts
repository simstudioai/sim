import { z } from 'zod'
import {
  introspectionResponseSchema,
  mongoDocumentsResponseSchema,
  sslModeSchema,
} from '@/lib/api/contracts/tools/databases/shared'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'

// Un-refined base so the downstream operation schemas can .extend it; each
// reattaches mongoUsernamePasswordPaired after its own .extend.
const mongoConnectionBaseSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required').optional(),
  password: z.string().min(1, 'Password is required').optional(),
  authSource: z.string().optional(),
  ssl: sslModeSchema,
})

const mongoUsernamePasswordPaired = (data: { username?: string; password?: string }) =>
  Boolean(data.username) === Boolean(data.password)
const mongoUsernamePasswordPairedError = {
  message: 'Username and password must be provided together',
  path: ['password' as const],
}

const mongoJsonStringOrObjectSchema = (message: string) =>
  z
    .union([z.string(), z.object({}).passthrough()])
    .transform((val) => {
      if (typeof val === 'object' && val !== null) {
        return JSON.stringify(val)
      }
      return val
    })
    .refine((val) => val && val.trim() !== '', { message })

const booleanStringSchema = z
  .union([z.boolean(), z.string(), z.undefined()])
  .optional()
  .transform((val) => {
    if (val === 'true' || val === true) return true
    if (val === 'false' || val === false) return false
    return false
  })

export const mongodbQueryBodySchema = mongoConnectionBaseSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    query: z
      .union([z.string(), z.object({}).passthrough()])
      .optional()
      .default('{}')
      .transform((val) => {
        if (typeof val === 'object' && val !== null) {
          return JSON.stringify(val)
        }
        return val || '{}'
      }),
    limit: z
      .union([z.coerce.number().int().positive(), z.literal(''), z.undefined()])
      .optional()
      .transform((val) => {
        if (val === '' || val === undefined || val === null) {
          return 100
        }
        return val
      }),
    sort: z
      .union([z.string(), z.object({}).passthrough(), z.null()])
      .optional()
      .transform((val) => {
        if (typeof val === 'object' && val !== null) {
          return JSON.stringify(val)
        }
        return val
      }),
  })
  .refine(mongoUsernamePasswordPaired, mongoUsernamePasswordPairedError)

export const mongodbExecuteBodySchema = mongoConnectionBaseSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    pipeline: z
      .union([z.string(), z.array(z.object({}).passthrough())])
      .transform((val) => {
        if (Array.isArray(val)) {
          return JSON.stringify(val)
        }
        return val
      })
      .refine((val) => val && val.trim() !== '', {
        message: 'Pipeline is required',
      }),
  })
  .refine(mongoUsernamePasswordPaired, mongoUsernamePasswordPairedError)

export const mongodbInsertBodySchema = mongoConnectionBaseSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    documents: z
      .union([z.array(z.record(z.string(), z.unknown())), z.string()])
      .transform((val) => {
        if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val)
            return Array.isArray(parsed) ? parsed : [parsed]
          } catch {
            throw new Error('Invalid JSON in documents field')
          }
        }
        return val
      })
      .refine((val) => Array.isArray(val) && val.length > 0, {
        message: 'At least one document is required',
      }),
  })
  .refine(mongoUsernamePasswordPaired, mongoUsernamePasswordPairedError)

export const mongodbUpdateBodySchema = mongoConnectionBaseSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    filter: mongoJsonStringOrObjectSchema('Filter is required for MongoDB Update').refine(
      (val) => val !== '{}',
      { message: 'Filter is required for MongoDB Update' }
    ),
    update: mongoJsonStringOrObjectSchema('Update is required'),
    upsert: booleanStringSchema,
    multi: booleanStringSchema,
  })
  .refine(mongoUsernamePasswordPaired, mongoUsernamePasswordPairedError)

export const mongodbDeleteBodySchema = mongoConnectionBaseSchema
  .extend({
    collection: z.string().min(1, 'Collection name is required'),
    filter: mongoJsonStringOrObjectSchema('Filter is required for MongoDB Delete').refine(
      (val) => val !== '{}',
      { message: 'Filter is required for MongoDB Delete' }
    ),
    multi: booleanStringSchema,
  })
  .refine(mongoUsernamePasswordPaired, mongoUsernamePasswordPairedError)

export const mongodbIntrospectBodySchema = z
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

export const mongodbQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mongodb/query',
  body: mongodbQueryBodySchema,
  response: { mode: 'json', schema: mongoDocumentsResponseSchema },
})

export const mongodbExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mongodb/execute',
  body: mongodbExecuteBodySchema,
  response: { mode: 'json', schema: mongoDocumentsResponseSchema },
})

export const mongodbInsertContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mongodb/insert',
  body: mongodbInsertBodySchema,
  response: { mode: 'json', schema: mongoDocumentsResponseSchema },
})

export const mongodbUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mongodb/update',
  body: mongodbUpdateBodySchema,
  response: { mode: 'json', schema: mongoDocumentsResponseSchema },
})

export const mongodbDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mongodb/delete',
  body: mongodbDeleteBodySchema,
  response: { mode: 'json', schema: mongoDocumentsResponseSchema },
})

export const mongodbIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mongodb/introspect',
  body: mongodbIntrospectBodySchema,
  response: { mode: 'json', schema: introspectionResponseSchema },
})

export type MongoDBQueryRequest = ContractBodyInput<typeof mongodbQueryContract>
export type MongoDBQueryResponse = ContractJsonResponse<typeof mongodbQueryContract>
export type MongoDBExecuteRequest = ContractBodyInput<typeof mongodbExecuteContract>
export type MongoDBExecuteResponse = ContractJsonResponse<typeof mongodbExecuteContract>
export type MongoDBInsertRequest = ContractBodyInput<typeof mongodbInsertContract>
export type MongoDBInsertResponse = ContractJsonResponse<typeof mongodbInsertContract>
export type MongoDBUpdateRequest = ContractBodyInput<typeof mongodbUpdateContract>
export type MongoDBUpdateResponse = ContractJsonResponse<typeof mongodbUpdateContract>
export type MongoDBDeleteRequest = ContractBodyInput<typeof mongodbDeleteContract>
export type MongoDBDeleteResponse = ContractJsonResponse<typeof mongodbDeleteContract>
export type MongoDBIntrospectRequest = ContractBodyInput<typeof mongodbIntrospectContract>
export type MongoDBIntrospectResponse = ContractJsonResponse<typeof mongodbIntrospectContract>

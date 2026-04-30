import { z } from 'zod'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const sslModeSchema = z.enum(['disabled', 'required', 'preferred']).default('preferred')
const neo4jEncryptionSchema = z.enum(['enabled', 'disabled']).default('disabled')

const nonEmptyRecordSchema = (message: string) =>
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

const sqlConnectionBodySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  ssl: sslModeSchema,
})

const sqlQueryBodySchema = sqlConnectionBodySchema.extend({
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

const sqlInsertBodySchema = sqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: sqlInsertDataSchema,
})

const sqlUpdateBodySchema = sqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: sqlUpdateDataSchema,
  where: z.string().min(1, 'WHERE clause is required'),
})

const sqlDeleteBodySchema = sqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  where: z.string().min(1, 'WHERE clause is required'),
})

export const postgresqlQueryBodySchema = sqlQueryBodySchema
export const postgresqlExecuteBodySchema = sqlQueryBodySchema
export const postgresqlInsertBodySchema = sqlInsertBodySchema
export const postgresqlUpdateBodySchema = sqlUpdateBodySchema
export const postgresqlDeleteBodySchema = sqlDeleteBodySchema
export const postgresqlIntrospectBodySchema = sqlConnectionBodySchema.extend({
  schema: z.string().default('public'),
})

export const mysqlQueryBodySchema = sqlQueryBodySchema
export const mysqlExecuteBodySchema = sqlQueryBodySchema
export const mysqlInsertBodySchema = sqlInsertBodySchema
export const mysqlUpdateBodySchema = sqlUpdateBodySchema
export const mysqlDeleteBodySchema = sqlDeleteBodySchema
export const mysqlIntrospectBodySchema = sqlConnectionBodySchema

const rdsConnectionBodySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
})

export const rdsQueryBodySchema = rdsConnectionBodySchema.extend({
  query: z.string().min(1, 'Query is required'),
})

export const rdsExecuteBodySchema = rdsQueryBodySchema
export const rdsInsertBodySchema = rdsConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: nonEmptyRecordSchema('Data object must have at least one field'),
})
export const rdsUpdateBodySchema = rdsConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: nonEmptyRecordSchema('Data object must have at least one field'),
  conditions: nonEmptyRecordSchema('At least one condition is required'),
})
export const rdsDeleteBodySchema = rdsConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  conditions: nonEmptyRecordSchema('At least one condition is required'),
})
export const rdsIntrospectBodySchema = rdsConnectionBodySchema.extend({
  schema: z.string().optional(),
  engine: z.enum(['aurora-postgresql', 'aurora-mysql']).optional(),
})

const mongoConnectionBodySchema = z
  .object({
    host: z.string().min(1, 'Host is required'),
    port: z.coerce.number().int().positive('Port must be a positive integer'),
    database: z.string().min(1, 'Database name is required'),
    username: z.string().min(1, 'Username is required').optional(),
    password: z.string().min(1, 'Password is required').optional(),
    authSource: z.string().optional(),
    ssl: sslModeSchema,
  })
  .refine((data) => Boolean(data.username) === Boolean(data.password), {
    message: 'Username and password must be provided together',
    path: ['password'],
  })

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

export const mongodbQueryBodySchema = mongoConnectionBodySchema.extend({
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

export const mongodbExecuteBodySchema = mongoConnectionBodySchema.extend({
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

export const mongodbInsertBodySchema = mongoConnectionBodySchema.extend({
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

export const mongodbUpdateBodySchema = mongoConnectionBodySchema.extend({
  collection: z.string().min(1, 'Collection name is required'),
  filter: mongoJsonStringOrObjectSchema('Filter is required for MongoDB Update').refine(
    (val) => val !== '{}',
    { message: 'Filter is required for MongoDB Update' }
  ),
  update: mongoJsonStringOrObjectSchema('Update is required'),
  upsert: booleanStringSchema,
  multi: booleanStringSchema,
})

export const mongodbDeleteBodySchema = mongoConnectionBodySchema.extend({
  collection: z.string().min(1, 'Collection name is required'),
  filter: mongoJsonStringOrObjectSchema('Filter is required for MongoDB Delete').refine(
    (val) => val !== '{}',
    { message: 'Filter is required for MongoDB Delete' }
  ),
  multi: booleanStringSchema,
})

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

const neo4jConnectionBodySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  encryption: neo4jEncryptionSchema,
})

const neo4jCypherBodySchema = neo4jConnectionBodySchema.extend({
  cypherQuery: z.string().min(1, 'Cypher query is required'),
  parameters: z.record(z.string(), z.unknown()).nullable().optional().default({}),
})

export const neo4jQueryBodySchema = neo4jCypherBodySchema
export const neo4jExecuteBodySchema = neo4jCypherBodySchema
export const neo4jCreateBodySchema = neo4jCypherBodySchema
export const neo4jUpdateBodySchema = neo4jCypherBodySchema
export const neo4jMergeBodySchema = neo4jCypherBodySchema
export const neo4jDeleteBodySchema = neo4jCypherBodySchema.extend({
  detach: z.boolean().optional().default(false),
})
export const neo4jIntrospectBodySchema = neo4jConnectionBodySchema

export const redisExecuteBodySchema = z.object({
  url: z.string().min(1, 'Redis connection URL is required'),
  command: z.string().min(1, 'Redis command is required'),
  args: z.array(z.union([z.string(), z.number()])).default([]),
})

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

const sqlRowsResponseSchema = z.object({
  message: z.string(),
  rows: z.array(z.unknown()),
  rowCount: z.number(),
})

const mongoDocumentsResponseSchema = z
  .object({
    message: z.string(),
    documents: z.array(z.unknown()).optional(),
    documentCount: z.number().optional(),
  })
  .passthrough()

const neo4jResponseSchema = z
  .object({
    message: z.string(),
  })
  .passthrough()

const introspectionResponseSchema = z
  .object({
    message: z.string(),
  })
  .passthrough()

const redisExecuteResponseSchema = z.object({
  result: z.unknown(),
})

const supabaseStorageUploadResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    message: z.string(),
    results: z.record(z.string(), z.unknown()),
  }),
})

export const postgresqlQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/postgresql/query',
  body: postgresqlQueryBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const postgresqlExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/postgresql/execute',
  body: postgresqlExecuteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const postgresqlInsertContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/postgresql/insert',
  body: postgresqlInsertBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const postgresqlUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/postgresql/update',
  body: postgresqlUpdateBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const postgresqlDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/postgresql/delete',
  body: postgresqlDeleteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const postgresqlIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/postgresql/introspect',
  body: postgresqlIntrospectBodySchema,
  response: { mode: 'json', schema: introspectionResponseSchema },
})

export const mysqlQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mysql/query',
  body: mysqlQueryBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mysqlExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mysql/execute',
  body: mysqlExecuteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mysqlInsertContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mysql/insert',
  body: mysqlInsertBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mysqlUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mysql/update',
  body: mysqlUpdateBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mysqlDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mysql/delete',
  body: mysqlDeleteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mysqlIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mysql/introspect',
  body: mysqlIntrospectBodySchema,
  response: { mode: 'json', schema: introspectionResponseSchema },
})

export const rdsQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/query',
  body: rdsQueryBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const rdsExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/execute',
  body: rdsExecuteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const rdsInsertContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/insert',
  body: rdsInsertBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const rdsUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/update',
  body: rdsUpdateBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const rdsDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/delete',
  body: rdsDeleteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const rdsIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/introspect',
  body: rdsIntrospectBodySchema,
  response: { mode: 'json', schema: introspectionResponseSchema },
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

export const neo4jQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/query',
  body: neo4jQueryBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/execute',
  body: neo4jExecuteBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jCreateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/create',
  body: neo4jCreateBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/update',
  body: neo4jUpdateBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/delete',
  body: neo4jDeleteBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jMergeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/merge',
  body: neo4jMergeBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/introspect',
  body: neo4jIntrospectBodySchema,
  response: { mode: 'json', schema: introspectionResponseSchema },
})

export const redisExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/redis/execute',
  body: redisExecuteBodySchema,
  response: { mode: 'json', schema: redisExecuteResponseSchema },
})

export const supabaseStorageUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/supabase/storage-upload',
  body: supabaseStorageUploadBodySchema,
  response: { mode: 'json', schema: supabaseStorageUploadResponseSchema },
})

export type PostgreSQLQueryRequest = ContractBodyInput<typeof postgresqlQueryContract>
export type PostgreSQLQueryResponse = ContractJsonResponse<typeof postgresqlQueryContract>
export type PostgreSQLExecuteRequest = ContractBodyInput<typeof postgresqlExecuteContract>
export type PostgreSQLExecuteResponse = ContractJsonResponse<typeof postgresqlExecuteContract>
export type PostgreSQLInsertRequest = ContractBodyInput<typeof postgresqlInsertContract>
export type PostgreSQLInsertResponse = ContractJsonResponse<typeof postgresqlInsertContract>
export type PostgreSQLUpdateRequest = ContractBodyInput<typeof postgresqlUpdateContract>
export type PostgreSQLUpdateResponse = ContractJsonResponse<typeof postgresqlUpdateContract>
export type PostgreSQLDeleteRequest = ContractBodyInput<typeof postgresqlDeleteContract>
export type PostgreSQLDeleteResponse = ContractJsonResponse<typeof postgresqlDeleteContract>
export type PostgreSQLIntrospectRequest = ContractBodyInput<typeof postgresqlIntrospectContract>
export type PostgreSQLIntrospectResponse = ContractJsonResponse<typeof postgresqlIntrospectContract>

export type MySQLQueryRequest = ContractBodyInput<typeof mysqlQueryContract>
export type MySQLQueryResponse = ContractJsonResponse<typeof mysqlQueryContract>
export type MySQLExecuteRequest = ContractBodyInput<typeof mysqlExecuteContract>
export type MySQLExecuteResponse = ContractJsonResponse<typeof mysqlExecuteContract>
export type MySQLInsertRequest = ContractBodyInput<typeof mysqlInsertContract>
export type MySQLInsertResponse = ContractJsonResponse<typeof mysqlInsertContract>
export type MySQLUpdateRequest = ContractBodyInput<typeof mysqlUpdateContract>
export type MySQLUpdateResponse = ContractJsonResponse<typeof mysqlUpdateContract>
export type MySQLDeleteRequest = ContractBodyInput<typeof mysqlDeleteContract>
export type MySQLDeleteResponse = ContractJsonResponse<typeof mysqlDeleteContract>
export type MySQLIntrospectRequest = ContractBodyInput<typeof mysqlIntrospectContract>
export type MySQLIntrospectResponse = ContractJsonResponse<typeof mysqlIntrospectContract>

export type RdsQueryRequest = ContractBodyInput<typeof rdsQueryContract>
export type RdsQueryResponse = ContractJsonResponse<typeof rdsQueryContract>
export type RdsExecuteRequest = ContractBodyInput<typeof rdsExecuteContract>
export type RdsExecuteResponse = ContractJsonResponse<typeof rdsExecuteContract>
export type RdsInsertRequest = ContractBodyInput<typeof rdsInsertContract>
export type RdsInsertResponse = ContractJsonResponse<typeof rdsInsertContract>
export type RdsUpdateRequest = ContractBodyInput<typeof rdsUpdateContract>
export type RdsUpdateResponse = ContractJsonResponse<typeof rdsUpdateContract>
export type RdsDeleteRequest = ContractBodyInput<typeof rdsDeleteContract>
export type RdsDeleteResponse = ContractJsonResponse<typeof rdsDeleteContract>
export type RdsIntrospectRequest = ContractBodyInput<typeof rdsIntrospectContract>
export type RdsIntrospectResponse = ContractJsonResponse<typeof rdsIntrospectContract>

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

export type Neo4jQueryRequest = ContractBodyInput<typeof neo4jQueryContract>
export type Neo4jQueryResponse = ContractJsonResponse<typeof neo4jQueryContract>
export type Neo4jExecuteRequest = ContractBodyInput<typeof neo4jExecuteContract>
export type Neo4jExecuteResponse = ContractJsonResponse<typeof neo4jExecuteContract>
export type Neo4jCreateRequest = ContractBodyInput<typeof neo4jCreateContract>
export type Neo4jCreateResponse = ContractJsonResponse<typeof neo4jCreateContract>
export type Neo4jUpdateRequest = ContractBodyInput<typeof neo4jUpdateContract>
export type Neo4jUpdateResponse = ContractJsonResponse<typeof neo4jUpdateContract>
export type Neo4jDeleteRequest = ContractBodyInput<typeof neo4jDeleteContract>
export type Neo4jDeleteResponse = ContractJsonResponse<typeof neo4jDeleteContract>
export type Neo4jMergeRequest = ContractBodyInput<typeof neo4jMergeContract>
export type Neo4jMergeResponse = ContractJsonResponse<typeof neo4jMergeContract>
export type Neo4jIntrospectRequest = ContractBodyInput<typeof neo4jIntrospectContract>
export type Neo4jIntrospectResponse = ContractJsonResponse<typeof neo4jIntrospectContract>

export type RedisExecuteRequest = ContractBodyInput<typeof redisExecuteContract>
export type RedisExecuteResponse = ContractJsonResponse<typeof redisExecuteContract>

export type SupabaseStorageUploadRequest = ContractBodyInput<typeof supabaseStorageUploadContract>
export type SupabaseStorageUploadResponse = ContractJsonResponse<
  typeof supabaseStorageUploadContract
>

import { z } from 'zod'
import {
  introspectionResponseSchema,
  nonEmptyRecordSchema,
  sqlRowsResponseSchema,
} from '@/lib/api/contracts/tools/databases/shared'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'

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

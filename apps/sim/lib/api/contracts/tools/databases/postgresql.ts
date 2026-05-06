import { z } from 'zod'
import {
  introspectionResponseSchema,
  sqlConnectionBodySchema,
  sqlDeleteBodySchema,
  sqlInsertBodySchema,
  sqlQueryBodySchema,
  sqlRowsResponseSchema,
  sqlUpdateBodySchema,
} from '@/lib/api/contracts/tools/databases/shared'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'

export const postgresqlQueryBodySchema = sqlQueryBodySchema
export const postgresqlExecuteBodySchema = sqlQueryBodySchema
export const postgresqlInsertBodySchema = sqlInsertBodySchema
export const postgresqlUpdateBodySchema = sqlUpdateBodySchema
export const postgresqlDeleteBodySchema = sqlDeleteBodySchema
export const postgresqlIntrospectBodySchema = sqlConnectionBodySchema.extend({
  schema: z.string().default('public'),
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

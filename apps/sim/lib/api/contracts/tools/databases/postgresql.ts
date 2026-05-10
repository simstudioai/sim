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

const postgresqlQueryBodySchema = sqlQueryBodySchema
const postgresqlExecuteBodySchema = sqlQueryBodySchema
const postgresqlInsertBodySchema = sqlInsertBodySchema
const postgresqlUpdateBodySchema = sqlUpdateBodySchema
const postgresqlDeleteBodySchema = sqlDeleteBodySchema
const postgresqlIntrospectBodySchema = sqlConnectionBodySchema.extend({
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

type PostgreSQLQueryRequest = ContractBodyInput<typeof postgresqlQueryContract>
type PostgreSQLQueryResponse = ContractJsonResponse<typeof postgresqlQueryContract>
type PostgreSQLExecuteRequest = ContractBodyInput<typeof postgresqlExecuteContract>
type PostgreSQLExecuteResponse = ContractJsonResponse<typeof postgresqlExecuteContract>
type PostgreSQLInsertRequest = ContractBodyInput<typeof postgresqlInsertContract>
type PostgreSQLInsertResponse = ContractJsonResponse<typeof postgresqlInsertContract>
type PostgreSQLUpdateRequest = ContractBodyInput<typeof postgresqlUpdateContract>
type PostgreSQLUpdateResponse = ContractJsonResponse<typeof postgresqlUpdateContract>
type PostgreSQLDeleteRequest = ContractBodyInput<typeof postgresqlDeleteContract>
type PostgreSQLDeleteResponse = ContractJsonResponse<typeof postgresqlDeleteContract>
type PostgreSQLIntrospectRequest = ContractBodyInput<typeof postgresqlIntrospectContract>
type PostgreSQLIntrospectResponse = ContractJsonResponse<typeof postgresqlIntrospectContract>

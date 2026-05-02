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

export const mysqlQueryBodySchema = sqlQueryBodySchema
export const mysqlExecuteBodySchema = sqlQueryBodySchema
export const mysqlInsertBodySchema = sqlInsertBodySchema
export const mysqlUpdateBodySchema = sqlUpdateBodySchema
export const mysqlDeleteBodySchema = sqlDeleteBodySchema
export const mysqlIntrospectBodySchema = sqlConnectionBodySchema

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

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

const mysqlQueryBodySchema = sqlQueryBodySchema
const mysqlExecuteBodySchema = sqlQueryBodySchema
const mysqlInsertBodySchema = sqlInsertBodySchema
const mysqlUpdateBodySchema = sqlUpdateBodySchema
const mysqlDeleteBodySchema = sqlDeleteBodySchema
const mysqlIntrospectBodySchema = sqlConnectionBodySchema

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

type MySQLQueryRequest = ContractBodyInput<typeof mysqlQueryContract>
type MySQLQueryResponse = ContractJsonResponse<typeof mysqlQueryContract>
type MySQLExecuteRequest = ContractBodyInput<typeof mysqlExecuteContract>
type MySQLExecuteResponse = ContractJsonResponse<typeof mysqlExecuteContract>
type MySQLInsertRequest = ContractBodyInput<typeof mysqlInsertContract>
type MySQLInsertResponse = ContractJsonResponse<typeof mysqlInsertContract>
type MySQLUpdateRequest = ContractBodyInput<typeof mysqlUpdateContract>
type MySQLUpdateResponse = ContractJsonResponse<typeof mysqlUpdateContract>
type MySQLDeleteRequest = ContractBodyInput<typeof mysqlDeleteContract>
type MySQLDeleteResponse = ContractJsonResponse<typeof mysqlDeleteContract>
type MySQLIntrospectRequest = ContractBodyInput<typeof mysqlIntrospectContract>
type MySQLIntrospectResponse = ContractJsonResponse<typeof mysqlIntrospectContract>

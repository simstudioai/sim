import { z } from 'zod'
import {
  introspectionResponseSchema,
  sqlInsertDataSchema,
  sqlRowsResponseSchema,
  sqlUpdateDataSchema,
} from '@/lib/api/contracts/tools/databases/shared'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'

/**
 * Toggle schema for the two TLS switches the `mssql` (Tedious) driver exposes.
 * Modelled as an enum rather than a boolean because block dropdowns serialize
 * strings, and `z.coerce.boolean()` would turn the string `'false'` into `true`.
 * @see https://github.com/tediousjs/node-mssql#tedious
 */
export const mssqlToggleSchema = z.enum(['enabled', 'disabled'])

/**
 * Connection fields shared by every Microsoft SQL Server tool route.
 * Field placement mirrors the driver: `connectionTimeout` and `requestTimeout`
 * are top-level, while `encrypt` and `trustServerCertificate` live under
 * `options`. Named instances are unsupported because the driver resolves them
 * with an unpinnable SQL Server Browser lookup; use a static TCP port instead.
 * @see https://github.com/tediousjs/node-mssql#general-same-for-all-drivers
 */
export const mssqlConnectionBodySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce
    .number()
    .int()
    .min(1, 'Port must be between 1 and 65535')
    .max(65535, 'Port must be between 1 and 65535')
    .default(1433),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  encrypt: mssqlToggleSchema.default('enabled'),
  trustServerCertificate: mssqlToggleSchema.default('disabled'),
  connectionTimeout: z.coerce
    .number()
    .int()
    .min(1000, 'connectionTimeout must be at least 1000 ms')
    .max(120000, 'connectionTimeout must be at most 120000 ms')
    .default(15000),
})

export const mssqlQueryBodySchema = mssqlConnectionBodySchema.extend({
  query: z.string().min(1, 'Query is required'),
})

export const mssqlExecuteBodySchema = mssqlQueryBodySchema

export const mssqlInsertBodySchema = mssqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: sqlInsertDataSchema,
})

export const mssqlUpdateBodySchema = mssqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: sqlUpdateDataSchema,
  where: z.string().min(1, 'WHERE clause is required'),
})

export const mssqlDeleteBodySchema = mssqlConnectionBodySchema.extend({
  table: z.string().min(1, 'Table name is required'),
  where: z.string().min(1, 'WHERE clause is required'),
})

export const mssqlIntrospectBodySchema = mssqlConnectionBodySchema.extend({
  schema: z.string().min(1, 'Schema name cannot be empty').default('dbo'),
})

export const mssqlQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mssql/query',
  body: mssqlQueryBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mssqlExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mssql/execute',
  body: mssqlExecuteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mssqlInsertContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mssql/insert',
  body: mssqlInsertBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mssqlUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mssql/update',
  body: mssqlUpdateBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mssqlDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mssql/delete',
  body: mssqlDeleteBodySchema,
  response: { mode: 'json', schema: sqlRowsResponseSchema },
})

export const mssqlIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mssql/introspect',
  body: mssqlIntrospectBodySchema,
  response: { mode: 'json', schema: introspectionResponseSchema },
})

export type MSSQLQueryRequest = ContractBodyInput<typeof mssqlQueryContract>
export type MSSQLQueryResponse = ContractJsonResponse<typeof mssqlQueryContract>
export type MSSQLExecuteRequest = ContractBodyInput<typeof mssqlExecuteContract>
export type MSSQLExecuteResponse = ContractJsonResponse<typeof mssqlExecuteContract>
export type MSSQLInsertRequest = ContractBodyInput<typeof mssqlInsertContract>
export type MSSQLInsertResponse = ContractJsonResponse<typeof mssqlInsertContract>
export type MSSQLUpdateRequest = ContractBodyInput<typeof mssqlUpdateContract>
export type MSSQLUpdateResponse = ContractJsonResponse<typeof mssqlUpdateContract>
export type MSSQLDeleteRequest = ContractBodyInput<typeof mssqlDeleteContract>
export type MSSQLDeleteResponse = ContractJsonResponse<typeof mssqlDeleteContract>
export type MSSQLIntrospectRequest = ContractBodyInput<typeof mssqlIntrospectContract>
export type MSSQLIntrospectResponse = ContractJsonResponse<typeof mssqlIntrospectContract>

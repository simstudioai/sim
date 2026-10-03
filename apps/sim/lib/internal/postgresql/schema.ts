import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'

const sslModeSchema = z.enum(['disabled', 'required', 'preferred']).default('preferred')

const nonEmptyRecordSchema = (message: string) =>
  z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, { message })

const jsonObjectStringSchema = (message: string, includeReceivedValue = false) =>
  z
    .string()
    .min(1)
    .transform((value) => {
      try {
        const parsed = JSON.parse(value)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Data must be a JSON object')
        }
        return parsed
      } catch (error) {
        if (!includeReceivedValue) throw new Error(message)
        throw new Error(
          `${message}: ${getErrorMessage(error, 'Unknown error')}. Received: ${value.substring(0, 100)}...`
        )
      }
    })

const connectionInputSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  ssl: sslModeSchema,
})

const queryInputSchema = connectionInputSchema.extend({
  query: z.string().min(1, 'Query is required'),
})
const insertDataSchema = z.union([
  nonEmptyRecordSchema('Data object cannot be empty'),
  jsonObjectStringSchema('Invalid JSON format in data field', true),
])
const updateDataSchema = z.union([
  nonEmptyRecordSchema('Data object cannot be empty'),
  jsonObjectStringSchema('Invalid JSON format in data field'),
])

export const postgresqlQueryInputSchema = queryInputSchema
export const postgresqlExecuteInputSchema = queryInputSchema
export const postgresqlInsertInputSchema = connectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: insertDataSchema,
})
export const postgresqlUpdateInputSchema = connectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: updateDataSchema,
  where: z.string().min(1, 'WHERE clause is required'),
})
export const postgresqlDeleteInputSchema = connectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  where: z.string().min(1, 'WHERE clause is required'),
})
export const postgresqlIntrospectInputSchema = connectionInputSchema.extend({
  schema: z.string().default('public'),
})

export type PostgresqlQueryInput = z.output<typeof postgresqlQueryInputSchema>
export type PostgresqlExecuteInput = z.output<typeof postgresqlExecuteInputSchema>
export type PostgresqlInsertInput = z.output<typeof postgresqlInsertInputSchema>
export type PostgresqlUpdateInput = z.output<typeof postgresqlUpdateInputSchema>
export type PostgresqlDeleteInput = z.output<typeof postgresqlDeleteInputSchema>
export type PostgresqlIntrospectInput = z.output<typeof postgresqlIntrospectInputSchema>

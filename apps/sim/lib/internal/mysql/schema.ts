import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'

const sslModeSchema = z.enum(['disabled', 'required', 'preferred']).default('preferred')
/**
 * TLS mode for a MySQL connection: `required` encrypts and verifies the server certificate,
 * `preferred` encrypts without verifying it, and `disabled` connects without TLS.
 */
export type MysqlSslMode = z.output<typeof sslModeSchema>

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

/** The connection fields every MySQL operation takes; a saved connection stores the same fields. */
export const mysqlConnectionInputSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  ssl: sslModeSchema,
})

const queryInputSchema = mysqlConnectionInputSchema.extend({
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

export const mysqlQueryInputSchema = queryInputSchema
export const mysqlExecuteInputSchema = queryInputSchema
export const mysqlInsertInputSchema = mysqlConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: insertDataSchema,
})
export const mysqlUpdateInputSchema = mysqlConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: updateDataSchema,
  where: z.string().min(1, 'WHERE clause is required'),
})
export const mysqlDeleteInputSchema = mysqlConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  where: z.string().min(1, 'WHERE clause is required'),
})

export type MysqlQueryInput = z.output<typeof mysqlQueryInputSchema>
export type MysqlExecuteInput = z.output<typeof mysqlExecuteInputSchema>
export type MysqlInsertInput = z.output<typeof mysqlInsertInputSchema>
export type MysqlUpdateInput = z.output<typeof mysqlUpdateInputSchema>
export type MysqlDeleteInput = z.output<typeof mysqlDeleteInputSchema>
/** Introspection takes only a connection. */
export type MysqlIntrospectInput = z.output<typeof mysqlConnectionInputSchema>

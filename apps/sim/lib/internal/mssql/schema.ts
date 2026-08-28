import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'

export const mssqlToggleSchema = z.enum(['enabled', 'disabled'])

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

const insertDataSchema = z.union([
  nonEmptyRecordSchema('Data object cannot be empty'),
  jsonObjectStringSchema('Invalid JSON format in data field', true),
])
const updateDataSchema = z.union([
  nonEmptyRecordSchema('Data object cannot be empty'),
  jsonObjectStringSchema('Invalid JSON format in data field'),
])

export const mssqlConnectionInputSchema = z.object({
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

export const mssqlQueryInputSchema = mssqlConnectionInputSchema.extend({
  query: z.string().min(1, 'Query is required'),
})
export const mssqlExecuteInputSchema = mssqlQueryInputSchema
export const mssqlInsertInputSchema = mssqlConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: insertDataSchema,
})
export const mssqlUpdateInputSchema = mssqlConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: updateDataSchema,
  where: z.string().min(1, 'WHERE clause is required'),
})
export const mssqlDeleteInputSchema = mssqlConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  where: z.string().min(1, 'WHERE clause is required'),
})
export const mssqlIntrospectInputSchema = mssqlConnectionInputSchema.extend({
  schema: z.string().min(1, 'Schema name cannot be empty').default('dbo'),
})

export type MssqlQueryInput = z.output<typeof mssqlQueryInputSchema>
export type MssqlExecuteInput = z.output<typeof mssqlExecuteInputSchema>
export type MssqlInsertInput = z.output<typeof mssqlInsertInputSchema>
export type MssqlUpdateInput = z.output<typeof mssqlUpdateInputSchema>
export type MssqlDeleteInput = z.output<typeof mssqlDeleteInputSchema>
export type MssqlIntrospectInput = z.output<typeof mssqlIntrospectInputSchema>

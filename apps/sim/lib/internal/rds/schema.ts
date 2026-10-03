import { z } from 'zod'

const nonEmptyRecordSchema = (message: string) =>
  z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, { message })

const rdsConnectionInputSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
})

export const rdsQueryInputSchema = rdsConnectionInputSchema.extend({
  query: z.string().min(1, 'Query is required'),
})
export const rdsExecuteInputSchema = rdsQueryInputSchema
export const rdsInsertInputSchema = rdsConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: nonEmptyRecordSchema('Data object must have at least one field'),
})
export const rdsUpdateInputSchema = rdsConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: nonEmptyRecordSchema('Data object must have at least one field'),
  conditions: nonEmptyRecordSchema('At least one condition is required'),
})
export const rdsDeleteInputSchema = rdsConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  conditions: nonEmptyRecordSchema('At least one condition is required'),
})
export const rdsIntrospectInputSchema = rdsConnectionInputSchema.extend({
  schema: z.string().optional(),
  engine: z.enum(['aurora-postgresql', 'aurora-mysql']).optional(),
})

export type RdsQueryInput = z.output<typeof rdsQueryInputSchema>
export type RdsExecuteInput = z.output<typeof rdsExecuteInputSchema>
export type RdsInsertInput = z.output<typeof rdsInsertInputSchema>
export type RdsUpdateInput = z.output<typeof rdsUpdateInputSchema>
export type RdsDeleteInput = z.output<typeof rdsDeleteInputSchema>
export type RdsIntrospectInput = z.output<typeof rdsIntrospectInputSchema>

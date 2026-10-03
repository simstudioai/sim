import { z } from 'zod'

const booleanFlagSchema = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value))
    .default(defaultValue)

const nonEmptyRecordSchema = (message: string) =>
  z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, { message })

export const clickhouseConnectionInputSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().default(''),
  secure: booleanFlagSchema(true),
})

const tableInputSchema = clickhouseConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
})

export const clickhouseQueryInputSchema = clickhouseConnectionInputSchema.extend({
  query: z.string().min(1, 'Query is required'),
})
export const clickhouseExecuteInputSchema = clickhouseQueryInputSchema
export const clickhouseInsertInputSchema = clickhouseConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: nonEmptyRecordSchema('Data object cannot be empty'),
})
export const clickhouseUpdateInputSchema = clickhouseConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  data: nonEmptyRecordSchema('Data object cannot be empty'),
  where: z.string().min(1, 'WHERE clause is required'),
})
export const clickhouseDeleteInputSchema = clickhouseConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  where: z.string().min(1, 'WHERE clause is required'),
})
export const clickhouseIntrospectInputSchema = clickhouseConnectionInputSchema
export const clickhouseListDatabasesInputSchema = clickhouseConnectionInputSchema
export const clickhouseListTablesInputSchema = clickhouseConnectionInputSchema
export const clickhouseDescribeTableInputSchema = tableInputSchema
export const clickhouseShowCreateTableInputSchema = tableInputSchema
export const clickhouseCountRowsInputSchema = tableInputSchema.extend({
  where: z.string().optional(),
})
export const clickhouseListPartitionsInputSchema = tableInputSchema
export const clickhouseListMutationsInputSchema = clickhouseConnectionInputSchema.extend({
  table: z.string().optional(),
  onlyRunning: booleanFlagSchema(false),
})
export const clickhouseListRunningQueriesInputSchema = clickhouseConnectionInputSchema
export const clickhouseTableStatsInputSchema = clickhouseConnectionInputSchema.extend({
  table: z.string().optional(),
})
export const clickhouseListClustersInputSchema = clickhouseConnectionInputSchema
export const clickhouseCreateDatabaseInputSchema = clickhouseConnectionInputSchema.extend({
  name: z.string().min(1, 'Database name is required'),
})
export const clickhouseDropDatabaseInputSchema = clickhouseConnectionInputSchema.extend({
  name: z.string().min(1, 'Database name is required'),
})
export const clickhouseCreateTableInputSchema = clickhouseConnectionInputSchema.extend({
  table: z.string().min(1, 'Table name is required'),
  columns: z
    .array(
      z.object({
        name: z.string().min(1, 'Column name is required'),
        type: z.string().min(1, 'Column type is required'),
      })
    )
    .min(1, 'At least one column is required'),
  engine: z.string().min(1).default('MergeTree'),
  orderBy: z.string().min(1, 'ORDER BY expression is required'),
  partitionBy: z.string().optional(),
})
export const clickhouseDropTableInputSchema = tableInputSchema
export const clickhouseTruncateTableInputSchema = tableInputSchema
export const clickhouseRenameTableInputSchema = tableInputSchema.extend({
  newTable: z.string().min(1, 'New table name is required'),
})
export const clickhouseOptimizeTableInputSchema = tableInputSchema.extend({
  final: booleanFlagSchema(false),
})
export const clickhouseDropPartitionInputSchema = tableInputSchema.extend({
  partition: z.string().min(1, 'Partition expression is required'),
})
export const clickhouseKillQueryInputSchema = clickhouseConnectionInputSchema.extend({
  queryId: z.string().min(1, 'Query ID is required'),
})
export const clickhouseInsertRowsInputSchema = tableInputSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'At least one row is required'),
})

export type ClickhouseQueryInput = z.output<typeof clickhouseQueryInputSchema>
export type ClickhouseExecuteInput = z.output<typeof clickhouseExecuteInputSchema>
export type ClickhouseInsertInput = z.output<typeof clickhouseInsertInputSchema>
export type ClickhouseUpdateInput = z.output<typeof clickhouseUpdateInputSchema>
export type ClickhouseDeleteInput = z.output<typeof clickhouseDeleteInputSchema>
export type ClickhouseIntrospectInput = z.output<typeof clickhouseIntrospectInputSchema>
export type ClickhouseListDatabasesInput = z.output<typeof clickhouseListDatabasesInputSchema>
export type ClickhouseListTablesInput = z.output<typeof clickhouseListTablesInputSchema>
export type ClickhouseDescribeTableInput = z.output<typeof clickhouseDescribeTableInputSchema>
export type ClickhouseShowCreateTableInput = z.output<typeof clickhouseShowCreateTableInputSchema>
export type ClickhouseCountRowsInput = z.output<typeof clickhouseCountRowsInputSchema>
export type ClickhouseListPartitionsInput = z.output<typeof clickhouseListPartitionsInputSchema>
export type ClickhouseListMutationsInput = z.output<typeof clickhouseListMutationsInputSchema>
export type ClickhouseListRunningQueriesInput = z.output<
  typeof clickhouseListRunningQueriesInputSchema
>
export type ClickhouseTableStatsInput = z.output<typeof clickhouseTableStatsInputSchema>
export type ClickhouseListClustersInput = z.output<typeof clickhouseListClustersInputSchema>
export type ClickhouseCreateDatabaseInput = z.output<typeof clickhouseCreateDatabaseInputSchema>
export type ClickhouseDropDatabaseInput = z.output<typeof clickhouseDropDatabaseInputSchema>
export type ClickhouseCreateTableInput = z.output<typeof clickhouseCreateTableInputSchema>
export type ClickhouseDropTableInput = z.output<typeof clickhouseDropTableInputSchema>
export type ClickhouseTruncateTableInput = z.output<typeof clickhouseTruncateTableInputSchema>
export type ClickhouseRenameTableInput = z.output<typeof clickhouseRenameTableInputSchema>
export type ClickhouseOptimizeTableInput = z.output<typeof clickhouseOptimizeTableInputSchema>
export type ClickhouseDropPartitionInput = z.output<typeof clickhouseDropPartitionInputSchema>
export type ClickhouseKillQueryInput = z.output<typeof clickhouseKillQueryInputSchema>
export type ClickhouseInsertRowsInput = z.output<typeof clickhouseInsertRowsInputSchema>

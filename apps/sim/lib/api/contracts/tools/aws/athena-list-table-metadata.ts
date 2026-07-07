import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ColumnSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  comment: z.string().nullable(),
})

const ListTableMetadataSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  catalogName: z.string().trim().min(1, 'Data catalog name is required'),
  databaseName: z.string().trim().min(1, 'Database name is required'),
  expression: z.string().optional(),
  workGroup: z.string().optional(),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(50).optional()
  ),
  nextToken: z.string().optional(),
})

const ListTableMetadataResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    tables: z.array(
      z.object({
        name: z.string(),
        tableType: z.string().nullable(),
        createTime: z.number().nullable(),
        lastAccessTime: z.number().nullable(),
        columns: z.array(ColumnSchema),
        partitionKeys: z.array(ColumnSchema),
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsAthenaListTableMetadataContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/list-table-metadata',
  body: ListTableMetadataSchema,
  response: { mode: 'json', schema: ListTableMetadataResponseSchema },
})
export type AwsAthenaListTableMetadataRequest = ContractBodyInput<
  typeof awsAthenaListTableMetadataContract
>
export type AwsAthenaListTableMetadataBody = ContractBody<typeof awsAthenaListTableMetadataContract>
export type AwsAthenaListTableMetadataResponse = ContractJsonResponse<
  typeof awsAthenaListTableMetadataContract
>

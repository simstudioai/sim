import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const QuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
  query: z.string().min(1, 'Query is required'),
})

export const awsRdsQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/query',
  body: QuerySchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsRdsQueryRequest = ContractBodyInput<typeof awsRdsQueryContract>
export type AwsRdsQueryBody = ContractBody<typeof awsRdsQueryContract>
export type AwsRdsQueryResponse = ContractJsonResponse<typeof awsRdsQueryContract>

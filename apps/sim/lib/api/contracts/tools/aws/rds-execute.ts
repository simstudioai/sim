import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ExecuteSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
  query: z.string().min(1, 'Query is required'),
})

export const awsRdsExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/execute',
  body: ExecuteSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsRdsExecuteRequest = ContractBodyInput<typeof awsRdsExecuteContract>
export type AwsRdsExecuteBody = ContractBody<typeof awsRdsExecuteContract>
export type AwsRdsExecuteResponse = ContractJsonResponse<typeof awsRdsExecuteContract>

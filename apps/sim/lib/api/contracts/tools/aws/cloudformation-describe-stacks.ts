import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DescribeStacksSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().optional(),
})

export const awsCloudformationDescribeStacksContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/describe-stacks',
  body: DescribeStacksSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsCloudformationDescribeStacksRequest = ContractBodyInput<
  typeof awsCloudformationDescribeStacksContract
>
export type AwsCloudformationDescribeStacksBody = ContractBody<
  typeof awsCloudformationDescribeStacksContract
>
export type AwsCloudformationDescribeStacksResponse = ContractJsonResponse<
  typeof awsCloudformationDescribeStacksContract
>

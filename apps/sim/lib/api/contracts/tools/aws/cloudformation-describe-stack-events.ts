import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DescribeStackEventsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
})

export const awsCloudformationDescribeStackEventsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/describe-stack-events',
  body: DescribeStackEventsSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsCloudformationDescribeStackEventsRequest = ContractBodyInput<
  typeof awsCloudformationDescribeStackEventsContract
>
export type AwsCloudformationDescribeStackEventsBody = ContractBody<
  typeof awsCloudformationDescribeStackEventsContract
>
export type AwsCloudformationDescribeStackEventsResponse = ContractJsonResponse<
  typeof awsCloudformationDescribeStackEventsContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DescribeStackDriftDetectionStatusSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackDriftDetectionId: z.string().min(1, 'Stack drift detection ID is required'),
})

const DescribeStackDriftDetectionStatusResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    stackId: z.string(),
    stackDriftDetectionId: z.string(),
    stackDriftStatus: z.string().optional(),
    detectionStatus: z.string(),
    detectionStatusReason: z.string().optional(),
    driftedStackResourceCount: z.number().optional(),
    timestamp: z.number().optional(),
  }),
})

export const awsCloudformationDescribeStackDriftDetectionStatusContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/describe-stack-drift-detection-status',
  body: DescribeStackDriftDetectionStatusSchema,
  response: { mode: 'json', schema: DescribeStackDriftDetectionStatusResponseSchema },
})
export type AwsCloudformationDescribeStackDriftDetectionStatusRequest = ContractBodyInput<
  typeof awsCloudformationDescribeStackDriftDetectionStatusContract
>
export type AwsCloudformationDescribeStackDriftDetectionStatusBody = ContractBody<
  typeof awsCloudformationDescribeStackDriftDetectionStatusContract
>
export type AwsCloudformationDescribeStackDriftDetectionStatusResponse = ContractJsonResponse<
  typeof awsCloudformationDescribeStackDriftDetectionStatusContract
>

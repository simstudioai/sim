import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DescribeChangeSetSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  changeSetName: z.string().min(1, 'Change set name is required'),
  stackName: z.string().optional(),
})

const DescribeChangeSetResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    changeSetName: z.string().optional(),
    changeSetId: z.string().optional(),
    stackId: z.string().optional(),
    stackName: z.string().optional(),
    description: z.string().optional(),
    executionStatus: z.string().optional(),
    status: z.string().optional(),
    statusReason: z.string().optional(),
    creationTime: z.number().optional(),
    capabilities: z.array(z.string()),
    changes: z.array(
      z.object({
        action: z.string().optional(),
        logicalResourceId: z.string().optional(),
        physicalResourceId: z.string().optional(),
        resourceType: z.string().optional(),
        replacement: z.string().optional(),
      })
    ),
  }),
})

export const awsCloudformationDescribeChangeSetContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/describe-change-set',
  body: DescribeChangeSetSchema,
  response: { mode: 'json', schema: DescribeChangeSetResponseSchema },
})
export type AwsCloudformationDescribeChangeSetRequest = ContractBodyInput<
  typeof awsCloudformationDescribeChangeSetContract
>
export type AwsCloudformationDescribeChangeSetBody = ContractBody<
  typeof awsCloudformationDescribeChangeSetContract
>
export type AwsCloudformationDescribeChangeSetResponse = ContractJsonResponse<
  typeof awsCloudformationDescribeChangeSetContract
>

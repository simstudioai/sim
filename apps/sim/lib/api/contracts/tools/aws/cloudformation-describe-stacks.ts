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

const DescribeStacksResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    stacks: z.array(
      z.object({
        stackName: z.string(),
        stackId: z.string(),
        stackStatus: z.string(),
        stackStatusReason: z.string().optional(),
        creationTime: z.number().optional(),
        lastUpdatedTime: z.number().optional(),
        description: z.string().optional(),
        enableTerminationProtection: z.boolean().optional(),
        driftInformation: z
          .object({
            stackDriftStatus: z.string().optional(),
            lastCheckTimestamp: z.number().optional(),
          })
          .nullable(),
        outputs: z.array(
          z.object({
            outputKey: z.string(),
            outputValue: z.string(),
            description: z.string().optional(),
            exportName: z.string().optional(),
          })
        ),
        tags: z.array(
          z.object({
            key: z.string(),
            value: z.string(),
          })
        ),
        parameters: z.array(
          z.object({
            parameterKey: z.string(),
            parameterValue: z.string().optional(),
            usePreviousValue: z.boolean().optional(),
            resolvedValue: z.string().optional(),
          })
        ),
        capabilities: z.array(z.string()),
        changeSetId: z.string().optional(),
        deletionTime: z.number().optional(),
        disableRollback: z.boolean().optional(),
        notificationArns: z.array(z.string()),
        timeoutInMinutes: z.number().optional(),
        roleArn: z.string().optional(),
        parentId: z.string().optional(),
        rootId: z.string().optional(),
        detailedStatus: z.string().optional(),
        deletionMode: z.string().optional(),
        retainExceptOnCreate: z.boolean().optional(),
      })
    ),
  }),
})

export const awsCloudformationDescribeStacksContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/describe-stacks',
  body: DescribeStacksSchema,
  response: { mode: 'json', schema: DescribeStacksResponseSchema },
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

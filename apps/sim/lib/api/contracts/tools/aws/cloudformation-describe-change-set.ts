import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DescribeChangeSetSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  changeSetName: z.string().min(1, 'Change set name is required'),
  stackName: z.string().optional(),
  nextToken: z.string().optional(),
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
        type: z.string().optional(),
        policyAction: z.string().optional(),
        scope: z.array(z.string()),
        changeSetId: z.string().optional(),
        details: z.array(
          z.object({
            attribute: z.string().optional(),
            name: z.string().optional(),
            requiresRecreation: z.string().optional(),
            evaluation: z.string().optional(),
            changeSource: z.string().optional(),
            causingEntity: z.string().optional(),
          })
        ),
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
    tags: z.array(z.object({ key: z.string(), value: z.string() })),
    notificationArns: z.array(z.string()),
    includeNestedStacks: z.boolean().optional(),
    parentChangeSetId: z.string().optional(),
    rootChangeSetId: z.string().optional(),
    onStackFailure: z.string().optional(),
    importExistingResources: z.boolean().optional(),
    nextToken: z.string().nullable(),
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

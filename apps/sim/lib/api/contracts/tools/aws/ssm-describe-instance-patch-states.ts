import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const INSTANCE_ID_PATTERN = /^(i-(\w{8}|\w{17})|mi-\w{17})$/

const InstancePatchStateSchema = z.object({
  instanceId: z.string(),
  patchGroup: z.string(),
  baselineId: z.string(),
  snapshotId: z.string().nullable(),
  ownerInformation: z.string().nullable(),
  installedCount: z.number().nullable(),
  installedOtherCount: z.number().nullable(),
  installedPendingRebootCount: z.number().nullable(),
  installedRejectedCount: z.number().nullable(),
  missingCount: z.number().nullable(),
  failedCount: z.number().nullable(),
  unreportedNotApplicableCount: z.number().nullable(),
  notApplicableCount: z.number().nullable(),
  criticalNonCompliantCount: z.number().nullable(),
  securityNonCompliantCount: z.number().nullable(),
  otherNonCompliantCount: z.number().nullable(),
  operation: z.string(),
  operationStartTime: z.string().nullable(),
  operationEndTime: z.string().nullable(),
  lastNoRebootInstallOperationTime: z.string().nullable(),
  rebootOption: z.string().nullable(),
})

const RequestSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  instanceIds: z
    .array(
      z.string().regex(INSTANCE_ID_PATTERN, 'instanceIds entries must look like i-0abc… or mi-…')
    )
    .min(1, 'At least one instance ID is required')
    .max(50, 'DescribeInstancePatchStates accepts at most 50 instance IDs'),
  maxResults: z.number().int().min(10).max(100).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  instancePatchStates: z.array(InstancePatchStateSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmDescribeInstancePatchStatesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/describe-instance-patch-states',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmDescribeInstancePatchStatesRequest = ContractBodyInput<
  typeof awsSsmDescribeInstancePatchStatesContract
>
export type AwsSsmDescribeInstancePatchStatesBody = ContractBody<
  typeof awsSsmDescribeInstancePatchStatesContract
>
export type AwsSsmDescribeInstancePatchStatesResponse = ContractJsonResponse<
  typeof awsSsmDescribeInstancePatchStatesContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const AutomationExecutionFilterSchema = z.object({
  Key: z.enum([
    'DocumentNamePrefix',
    'ExecutionStatus',
    'ExecutionId',
    'ParentExecutionId',
    'CurrentAction',
    'StartTimeBefore',
    'StartTimeAfter',
    'AutomationType',
    'TagKey',
    'TargetResourceGroup',
    'AutomationSubtype',
    'OpsItemId',
  ]),
  Values: z.array(z.string().min(1).max(150)).min(1).max(10),
})

const AutomationExecutionMetadataSchema = z.object({
  automationExecutionId: z.string(),
  documentName: z.string(),
  documentVersion: z.string().nullable(),
  automationExecutionStatus: z.string(),
  executionStartTime: z.string().nullable(),
  executionEndTime: z.string().nullable(),
  executedBy: z.string().nullable(),
  logFile: z.string().nullable(),
  mode: z.string().nullable(),
  parentAutomationExecutionId: z.string().nullable(),
  currentStepName: z.string().nullable(),
  currentAction: z.string().nullable(),
  failureMessage: z.string().nullable(),
  targetParameterName: z.string().nullable(),
  target: z.string().nullable(),
  automationType: z.string().nullable(),
  maxConcurrency: z.string().nullable(),
  maxErrors: z.string().nullable(),
  outputs: z.record(z.string(), z.array(z.string())).nullable(),
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
  filters: z.array(AutomationExecutionFilterSchema).max(10).nullish(),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  automationExecutions: z.array(AutomationExecutionMetadataSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmDescribeAutomationExecutionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/describe-automation-executions',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmDescribeAutomationExecutionsRequest = ContractBodyInput<
  typeof awsSsmDescribeAutomationExecutionsContract
>
export type AwsSsmDescribeAutomationExecutionsBody = ContractBody<
  typeof awsSsmDescribeAutomationExecutionsContract
>
export type AwsSsmDescribeAutomationExecutionsResponse = ContractJsonResponse<
  typeof awsSsmDescribeAutomationExecutionsContract
>

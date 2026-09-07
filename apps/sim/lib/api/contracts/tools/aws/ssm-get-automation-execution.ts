import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const EXECUTION_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const StepExecutionSchema = z.object({
  stepName: z.string().nullable(),
  action: z.string().nullable(),
  stepStatus: z.string().nullable(),
  stepExecutionId: z.string().nullable(),
  executionStartTime: z.string().nullable(),
  executionEndTime: z.string().nullable(),
  failureMessage: z.string().nullable(),
  response: z.string().nullable(),
  isEnd: z.boolean().nullable(),
  nextStep: z.string().nullable(),
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
  automationExecutionId: z
    .string()
    .regex(
      EXECUTION_ID_PATTERN,
      'automationExecutionId must be a 36-character automation execution ID'
    ),
})

const ResponseSchema = z.object({
  automationExecutionId: z.string(),
  documentName: z.string(),
  documentVersion: z.string().nullable(),
  automationExecutionStatus: z.string(),
  executionStartTime: z.string().nullable(),
  executionEndTime: z.string().nullable(),
  executedBy: z.string().nullable(),
  mode: z.string().nullable(),
  parentAutomationExecutionId: z.string().nullable(),
  currentStepName: z.string().nullable(),
  currentAction: z.string().nullable(),
  failureMessage: z.string().nullable(),
  targetParameterName: z.string().nullable(),
  target: z.string().nullable(),
  maxConcurrency: z.string().nullable(),
  maxErrors: z.string().nullable(),
  parameters: z.record(z.string(), z.array(z.string())).nullable(),
  outputs: z.record(z.string(), z.array(z.string())).nullable(),
  stepExecutions: z.array(StepExecutionSchema),
  stepExecutionsTruncated: z.boolean().nullable(),
})

export const awsSsmGetAutomationExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/get-automation-execution',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmGetAutomationExecutionRequest = ContractBodyInput<
  typeof awsSsmGetAutomationExecutionContract
>
export type AwsSsmGetAutomationExecutionBody = ContractBody<
  typeof awsSsmGetAutomationExecutionContract
>
export type AwsSsmGetAutomationExecutionResponse = ContractJsonResponse<
  typeof awsSsmGetAutomationExecutionContract
>

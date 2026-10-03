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
  stopType: z.enum(['Complete', 'Cancel']).nullish(),
})

const ResponseSchema = z.object({
  message: z.string(),
  automationExecutionId: z.string(),
})

export const awsSsmStopAutomationExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/stop-automation-execution',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmStopAutomationExecutionRequest = ContractBodyInput<
  typeof awsSsmStopAutomationExecutionContract
>
export type AwsSsmStopAutomationExecutionBody = ContractBody<
  typeof awsSsmStopAutomationExecutionContract
>
export type AwsSsmStopAutomationExecutionResponse = ContractJsonResponse<
  typeof awsSsmStopAutomationExecutionContract
>

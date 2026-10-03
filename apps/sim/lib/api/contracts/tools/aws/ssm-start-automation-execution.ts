import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DOCUMENT_NAME_PATTERN = /^[a-zA-Z0-9_\-.:/]{3,128}$/

const DOCUMENT_VERSION_PATTERN = /^(\$LATEST|\$DEFAULT|[1-9][0-9]*)$/

const MAX_CONCURRENCY_PATTERN = /^([1-9][0-9]*|[1-9][0-9]%|[1-9]%|100%)$/

const MAX_ERRORS_PATTERN = /^([1-9][0-9]*|[0]|[1-9][0-9]%|[0-9]%|100%)$/

const CLIENT_TOKEN_PATTERN =
  /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/

const TargetInputSchema = z.object({
  Key: z.string().min(1, 'Target Key is required'),
  Values: z.array(z.string()).min(1, 'Target Values must contain at least one value'),
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
  documentName: z
    .string()
    .regex(
      DOCUMENT_NAME_PATTERN,
      'documentName must be 3-128 characters of letters, digits, and _-.:/'
    ),
  documentVersion: z
    .string()
    .regex(
      DOCUMENT_VERSION_PATTERN,
      'documentVersion must be $LATEST, $DEFAULT, or a positive version number'
    )
    .nullish(),
  parameters: z.record(z.string(), z.array(z.string())).nullish(),
  mode: z.enum(['Auto', 'Interactive']).nullish(),
  targetParameterName: z.string().min(1).max(50).nullish(),
  targets: z.array(TargetInputSchema).max(1).nullish(),
  maxConcurrency: z
    .string()
    .max(7, 'maxConcurrency must be at most 7 characters')
    .regex(
      MAX_CONCURRENCY_PATTERN,
      'maxConcurrency must be a positive number or a percentage such as 10%'
    )
    .nullish(),
  maxErrors: z
    .string()
    .max(7, 'maxErrors must be at most 7 characters')
    .regex(MAX_ERRORS_PATTERN, 'maxErrors must be a number or a percentage such as 10%')
    .nullish(),
  clientToken: z
    .string()
    .regex(CLIENT_TOKEN_PATTERN, 'clientToken must be a 36-character UUID')
    .nullish(),
})

const ResponseSchema = z.object({
  automationExecutionId: z.string(),
})

const StartAutomationExecutionSchema = RequestSchema.superRefine((value, ctx) => {
  if (value.targets?.length && !value.targetParameterName) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetParameterName'],
      message: 'targetParameterName is required when targets is set',
    })
  }
  if (value.targetParameterName && !value.targets?.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['targets'],
      message: 'targets is required when targetParameterName is set',
    })
  }
})

export const awsSsmStartAutomationExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/start-automation-execution',
  body: StartAutomationExecutionSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmStartAutomationExecutionRequest = ContractBodyInput<
  typeof awsSsmStartAutomationExecutionContract
>
export type AwsSsmStartAutomationExecutionBody = ContractBody<
  typeof awsSsmStartAutomationExecutionContract
>
export type AwsSsmStartAutomationExecutionResponse = ContractJsonResponse<
  typeof awsSsmStartAutomationExecutionContract
>

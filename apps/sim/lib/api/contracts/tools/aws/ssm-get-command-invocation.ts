import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const INSTANCE_ID_PATTERN = /^(i-(\w{8}|\w{17})|mi-\w{17})$/

const COMMAND_ID_PATTERN =
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
  commandId: z.string().regex(COMMAND_ID_PATTERN, 'commandId must be a 36-character command ID'),
  instanceId: z.string().regex(INSTANCE_ID_PATTERN, 'instanceId must look like i-0abc… or mi-…'),
  pluginName: z.string().min(4).nullish(),
})

const ResponseSchema = z.object({
  commandId: z.string(),
  instanceId: z.string(),
  comment: z.string().nullable(),
  documentName: z.string().nullable(),
  documentVersion: z.string().nullable(),
  pluginName: z.string().nullable(),
  responseCode: z.number().nullable(),
  executionStartDateTime: z.string().nullable(),
  executionElapsedTime: z.string().nullable(),
  executionEndDateTime: z.string().nullable(),
  status: z.string(),
  statusDetails: z.string().nullable(),
  standardOutputContent: z.string(),
  standardOutputUrl: z.string().nullable(),
  standardErrorContent: z.string(),
  standardErrorUrl: z.string().nullable(),
})

export const awsSsmGetCommandInvocationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/get-command-invocation',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmGetCommandInvocationRequest = ContractBodyInput<
  typeof awsSsmGetCommandInvocationContract
>
export type AwsSsmGetCommandInvocationBody = ContractBody<typeof awsSsmGetCommandInvocationContract>
export type AwsSsmGetCommandInvocationResponse = ContractJsonResponse<
  typeof awsSsmGetCommandInvocationContract
>

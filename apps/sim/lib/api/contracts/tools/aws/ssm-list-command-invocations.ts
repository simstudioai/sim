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

const CommandFilterSchema = z.object({
  key: z.enum(['InvokedAfter', 'InvokedBefore', 'Status', 'DocumentName']),
  value: z.string().min(1, 'Filter value is required').max(128),
})

const CommandPluginSchema = z.object({
  name: z.string(),
  status: z.string(),
  statusDetails: z.string().nullable(),
  responseCode: z.number().nullable(),
  responseStartDateTime: z.string().nullable(),
  responseFinishDateTime: z.string().nullable(),
  output: z.string().nullable(),
  standardOutputUrl: z.string().nullable(),
  standardErrorUrl: z.string().nullable(),
})

const CommandInvocationSchema = z.object({
  commandId: z.string(),
  instanceId: z.string(),
  instanceName: z.string().nullable(),
  documentName: z.string().nullable(),
  documentVersion: z.string().nullable(),
  comment: z.string().nullable(),
  requestedDateTime: z.string().nullable(),
  status: z.string(),
  statusDetails: z.string().nullable(),
  traceOutput: z.string().nullable(),
  standardOutputUrl: z.string().nullable(),
  standardErrorUrl: z.string().nullable(),
  serviceRole: z.string().nullable(),
  commandPlugins: z.array(CommandPluginSchema),
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
  commandId: z
    .string()
    .regex(COMMAND_ID_PATTERN, 'commandId must be a 36-character command ID')
    .nullish(),
  instanceId: z
    .string()
    .regex(INSTANCE_ID_PATTERN, 'instanceId must look like i-0abc… or mi-…')
    .nullish(),
  filters: z.array(CommandFilterSchema).max(5).nullish(),
  details: z.boolean().nullish(),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  commandInvocations: z.array(CommandInvocationSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmListCommandInvocationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/list-command-invocations',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmListCommandInvocationsRequest = ContractBodyInput<
  typeof awsSsmListCommandInvocationsContract
>
export type AwsSsmListCommandInvocationsBody = ContractBody<
  typeof awsSsmListCommandInvocationsContract
>
export type AwsSsmListCommandInvocationsResponse = ContractJsonResponse<
  typeof awsSsmListCommandInvocationsContract
>

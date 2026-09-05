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
  key: z.enum(['InvokedAfter', 'InvokedBefore', 'Status', 'ExecutionStage', 'DocumentName']),
  value: z.string().min(1, 'Filter value is required').max(128),
})

const TargetSchema = z.object({
  key: z.string().nullable(),
  values: z.array(z.string()),
})

const CommandSchema = z.object({
  commandId: z.string(),
  documentName: z.string(),
  documentVersion: z.string().nullable(),
  comment: z.string().nullable(),
  status: z.string(),
  statusDetails: z.string().nullable(),
  requestedDateTime: z.string().nullable(),
  expiresAfter: z.string().nullable(),
  instanceIds: z.array(z.string()),
  targets: z.array(TargetSchema),
  maxConcurrency: z.string().nullable(),
  maxErrors: z.string().nullable(),
  targetCount: z.number().nullable(),
  completedCount: z.number().nullable(),
  errorCount: z.number().nullable(),
  deliveryTimedOutCount: z.number().nullable(),
  executionTimeoutSeconds: z.number().nullable(),
  outputS3BucketName: z.string().nullable(),
  outputS3KeyPrefix: z.string().nullable(),
  outputS3Region: z.string().nullable(),
  serviceRole: z.string().nullable(),
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
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  commands: z.array(CommandSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmListCommandsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/list-commands',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmListCommandsRequest = ContractBodyInput<typeof awsSsmListCommandsContract>
export type AwsSsmListCommandsBody = ContractBody<typeof awsSsmListCommandsContract>
export type AwsSsmListCommandsResponse = ContractJsonResponse<typeof awsSsmListCommandsContract>

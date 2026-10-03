import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const INSTANCE_ID_PATTERN = /^(i-(\w{8}|\w{17})|mi-\w{17})$/

const DOCUMENT_NAME_PATTERN = /^[a-zA-Z0-9_\-.:/]{3,128}$/

const DOCUMENT_VERSION_PATTERN = /^(\$LATEST|\$DEFAULT|[1-9][0-9]*)$/

const MAX_CONCURRENCY_PATTERN = /^([1-9][0-9]*|[1-9][0-9]%|[1-9]%|100%)$/

const MAX_ERRORS_PATTERN = /^([1-9][0-9]*|[0]|[1-9][0-9]%|[0-9]%|100%)$/

const TargetInputSchema = z.object({
  Key: z.string().min(1, 'Target Key is required'),
  Values: z.array(z.string()).min(1, 'Target Values must contain at least one value'),
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
  instanceIds: z
    .array(
      z.string().regex(INSTANCE_ID_PATTERN, 'instanceIds entries must look like i-0abc… or mi-…')
    )
    .max(50)
    .nullish(),
  targets: z.array(TargetInputSchema).max(5).nullish(),
  comment: z.string().max(100, 'comment must be at most 100 characters').nullish(),
  parameters: z.record(z.string(), z.array(z.string())).nullish(),
  executionTimeoutSeconds: z
    .number()
    .int()
    .min(30, 'executionTimeoutSeconds must be at least 30')
    .max(2592000, 'executionTimeoutSeconds must be at most 2592000')
    .nullish(),
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
  outputS3BucketName: z.string().min(3).max(63).nullish(),
  outputS3KeyPrefix: z.string().max(500).nullish(),
  serviceRoleArn: z.string().nullish(),
})

const ResponseSchema = CommandSchema

const SendCommandSchema = RequestSchema.superRefine((value, ctx) => {
  if (!value.instanceIds?.length && !value.targets?.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['instanceIds'],
      message: 'Provide instanceIds or targets to say which managed nodes should run the command',
    })
  }
})

export const awsSsmSendCommandContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/send-command',
  body: SendCommandSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmSendCommandRequest = ContractBodyInput<typeof awsSsmSendCommandContract>
export type AwsSsmSendCommandBody = ContractBody<typeof awsSsmSendCommandContract>
export type AwsSsmSendCommandResponse = ContractJsonResponse<typeof awsSsmSendCommandContract>

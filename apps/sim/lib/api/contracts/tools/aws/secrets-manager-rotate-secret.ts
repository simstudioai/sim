import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const RotateSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
  clientRequestToken: z
    .string()
    .min(32, 'Client request token must be at least 32 characters')
    .max(64, 'Client request token must be at most 64 characters')
    .nullish(),
  rotationLambdaARN: z.string().nullish(),
  automaticallyAfterDays: z
    .number()
    .min(1, 'Rotation interval must be at least 1 day')
    .max(1000, 'Rotation interval must be at most 1000 days')
    .nullish(),
  duration: z
    .string()
    .min(2, 'Duration must be 2-3 characters, e.g. "3h"')
    .max(3, 'Duration must be 2-3 characters, e.g. "3h"')
    .regex(/^[0-9]+h$/, 'Duration must match the pattern <hours>h, e.g. "3h"')
    .nullish(),
  scheduleExpression: z
    .string()
    .min(1, 'Schedule expression cannot be empty')
    .max(256, 'Schedule expression must be at most 256 characters')
    .regex(
      /^[0-9A-Za-z()#?*\-/, ]+$/,
      'Schedule expression may only contain alphanumerics and ()#?*-/, characters'
    )
    .nullish(),
  rotateImmediately: z.boolean().nullish(),
})

const RotateSecretResponseSchema = z.object({
  message: z.string(),
  name: z.string(),
  arn: z.string(),
  versionId: z.string(),
})

export const awsSecretsManagerRotateSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/rotate-secret',
  body: RotateSecretSchema,
  response: { mode: 'json', schema: RotateSecretResponseSchema },
})
export type AwsSecretsManagerRotateSecretRequest = ContractBodyInput<
  typeof awsSecretsManagerRotateSecretContract
>
export type AwsSecretsManagerRotateSecretBody = ContractBody<
  typeof awsSecretsManagerRotateSecretContract
>
export type AwsSecretsManagerRotateSecretResponse = ContractJsonResponse<
  typeof awsSecretsManagerRotateSecretContract
>

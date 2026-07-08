import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const RestoreSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
})

const RestoreSecretResponseSchema = z.object({
  message: z.string(),
  name: z.string(),
  arn: z.string(),
})

export const awsSecretsManagerRestoreSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/restore-secret',
  body: RestoreSecretSchema,
  response: { mode: 'json', schema: RestoreSecretResponseSchema },
})
export type AwsSecretsManagerRestoreSecretRequest = ContractBodyInput<
  typeof awsSecretsManagerRestoreSecretContract
>
export type AwsSecretsManagerRestoreSecretBody = ContractBody<
  typeof awsSecretsManagerRestoreSecretContract
>
export type AwsSecretsManagerRestoreSecretResponse = ContractJsonResponse<
  typeof awsSecretsManagerRestoreSecretContract
>

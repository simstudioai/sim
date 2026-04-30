import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UpdateSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
  secretValue: z.string().min(1, 'Secret value is required'),
  description: z.string().nullish(),
})

const UpdateSecretResponseSchema = z.object({
  message: z.string(),
  name: z.string(),
  arn: z.string(),
  versionId: z.string(),
})

export const awsSecretsManagerUpdateSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/update-secret',
  body: UpdateSecretSchema,
  response: { mode: 'json', schema: UpdateSecretResponseSchema },
})
export type AwsSecretsManagerUpdateSecretRequest = ContractBodyInput<
  typeof awsSecretsManagerUpdateSecretContract
>
export type AwsSecretsManagerUpdateSecretBody = ContractBody<
  typeof awsSecretsManagerUpdateSecretContract
>
export type AwsSecretsManagerUpdateSecretResponse = ContractJsonResponse<
  typeof awsSecretsManagerUpdateSecretContract
>

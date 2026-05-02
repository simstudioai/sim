import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
  recoveryWindowInDays: z.number().min(7).max(30).nullish(),
  forceDelete: z.boolean().nullish(),
})

const DeleteSecretResponseSchema = z.object({
  message: z.string(),
  name: z.string(),
  arn: z.string(),
  deletionDate: z.string().nullable(),
})

export const awsSecretsManagerDeleteSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/delete-secret',
  body: DeleteSecretSchema,
  response: { mode: 'json', schema: DeleteSecretResponseSchema },
})
export type AwsSecretsManagerDeleteSecretRequest = ContractBodyInput<
  typeof awsSecretsManagerDeleteSecretContract
>
export type AwsSecretsManagerDeleteSecretBody = ContractBody<
  typeof awsSecretsManagerDeleteSecretContract
>
export type AwsSecretsManagerDeleteSecretResponse = ContractJsonResponse<
  typeof awsSecretsManagerDeleteSecretContract
>

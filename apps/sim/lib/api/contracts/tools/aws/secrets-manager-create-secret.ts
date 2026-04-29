import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  name: z.string().min(1, 'Secret name is required'),
  secretValue: z.string().min(1, 'Secret value is required'),
  description: z.string().nullish(),
})

export const awsSecretsManagerCreateSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/create-secret',
  body: CreateSecretSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsSecretsManagerCreateSecretRequest = ContractBodyInput<
  typeof awsSecretsManagerCreateSecretContract
>
export type AwsSecretsManagerCreateSecretBody = ContractBody<
  typeof awsSecretsManagerCreateSecretContract
>
export type AwsSecretsManagerCreateSecretResponse = ContractJsonResponse<
  typeof awsSecretsManagerCreateSecretContract
>

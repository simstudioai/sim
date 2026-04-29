import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
  versionId: z.string().nullish(),
  versionStage: z.string().nullish(),
})

export const awsSecretsManagerGetSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/get-secret',
  body: GetSecretSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsSecretsManagerGetSecretRequest = ContractBodyInput<
  typeof awsSecretsManagerGetSecretContract
>
export type AwsSecretsManagerGetSecretBody = ContractBody<typeof awsSecretsManagerGetSecretContract>
export type AwsSecretsManagerGetSecretResponse = ContractJsonResponse<
  typeof awsSecretsManagerGetSecretContract
>

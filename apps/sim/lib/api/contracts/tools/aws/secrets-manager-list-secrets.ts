import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListSecretsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  maxResults: z.number().min(1).max(100).nullish(),
  nextToken: z.string().nullish(),
})

export const awsSecretsManagerListSecretsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/list-secrets',
  body: ListSecretsSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsSecretsManagerListSecretsRequest = ContractBodyInput<
  typeof awsSecretsManagerListSecretsContract
>
export type AwsSecretsManagerListSecretsBody = ContractBody<
  typeof awsSecretsManagerListSecretsContract
>
export type AwsSecretsManagerListSecretsResponse = ContractJsonResponse<
  typeof awsSecretsManagerListSecretsContract
>

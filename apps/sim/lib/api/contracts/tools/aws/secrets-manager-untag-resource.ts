import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UntagResourceSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
  tagKeys: z
    .array(
      z
        .string()
        .min(1, 'Tag key cannot be empty')
        .max(128, 'Tag key must be at most 128 characters')
    )
    .min(1, 'At least one tag key is required')
    .max(50, 'A maximum of 50 tag keys can be removed in a single request'),
})

const UntagResourceResponseSchema = z.object({
  message: z.string(),
  name: z.string(),
})

export const awsSecretsManagerUntagResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/untag-resource',
  body: UntagResourceSchema,
  response: { mode: 'json', schema: UntagResourceResponseSchema },
})
export type AwsSecretsManagerUntagResourceRequest = ContractBodyInput<
  typeof awsSecretsManagerUntagResourceContract
>
export type AwsSecretsManagerUntagResourceBody = ContractBody<
  typeof awsSecretsManagerUntagResourceContract
>
export type AwsSecretsManagerUntagResourceResponse = ContractJsonResponse<
  typeof awsSecretsManagerUntagResourceContract
>

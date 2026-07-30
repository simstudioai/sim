import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const TagResourceSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
  tags: z
    .array(
      z.object({
        key: z
          .string()
          .min(1, 'Tag key is required')
          .max(128, 'Tag key must be at most 128 characters'),
        value: z.string().max(256, 'Tag value must be at most 256 characters'),
      })
    )
    .min(1, 'At least one tag is required')
    .max(50, 'A maximum of 50 tags can be attached in a single request'),
})

const TagResourceResponseSchema = z.object({
  message: z.string(),
  name: z.string(),
})

export const awsSecretsManagerTagResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/tag-resource',
  body: TagResourceSchema,
  response: { mode: 'json', schema: TagResourceResponseSchema },
})
export type AwsSecretsManagerTagResourceRequest = ContractBodyInput<
  typeof awsSecretsManagerTagResourceContract
>
export type AwsSecretsManagerTagResourceBody = ContractBody<
  typeof awsSecretsManagerTagResourceContract
>
export type AwsSecretsManagerTagResourceResponse = ContractJsonResponse<
  typeof awsSecretsManagerTagResourceContract
>

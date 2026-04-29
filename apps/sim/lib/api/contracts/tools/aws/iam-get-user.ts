import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const Schema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  userName: z.string().min(1).optional().nullable(),
})

export const awsIamGetUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/get-user',
  body: Schema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsIamGetUserRequest = ContractBodyInput<typeof awsIamGetUserContract>
export type AwsIamGetUserBody = ContractBody<typeof awsIamGetUserContract>
export type AwsIamGetUserResponse = ContractJsonResponse<typeof awsIamGetUserContract>

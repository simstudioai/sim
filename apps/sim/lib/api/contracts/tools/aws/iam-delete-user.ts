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
  userName: z.string().min(1, 'User name is required'),
})

export const awsIamDeleteUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/delete-user',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamDeleteUserRequest = ContractBodyInput<typeof awsIamDeleteUserContract>
export type AwsIamDeleteUserBody = ContractBody<typeof awsIamDeleteUserContract>
export type AwsIamDeleteUserResponse = ContractJsonResponse<typeof awsIamDeleteUserContract>

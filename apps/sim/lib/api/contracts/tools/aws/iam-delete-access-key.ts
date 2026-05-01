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
  accessKeyIdToDelete: z.string().min(1, 'Access key ID to delete is required'),
  userName: z.string().optional().nullable(),
})

export const awsIamDeleteAccessKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/delete-access-key',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamDeleteAccessKeyRequest = ContractBodyInput<typeof awsIamDeleteAccessKeyContract>
export type AwsIamDeleteAccessKeyBody = ContractBody<typeof awsIamDeleteAccessKeyContract>
export type AwsIamDeleteAccessKeyResponse = ContractJsonResponse<
  typeof awsIamDeleteAccessKeyContract
>

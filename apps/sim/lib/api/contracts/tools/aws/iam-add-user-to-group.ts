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
  groupName: z.string().min(1, 'Group name is required'),
})

export const awsIamAddUserToGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/add-user-to-group',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamAddUserToGroupRequest = ContractBodyInput<typeof awsIamAddUserToGroupContract>
export type AwsIamAddUserToGroupBody = ContractBody<typeof awsIamAddUserToGroupContract>
export type AwsIamAddUserToGroupResponse = ContractJsonResponse<typeof awsIamAddUserToGroupContract>

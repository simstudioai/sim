import { z } from 'zod'
import { iamConnectionShape, iamRoleNameSchema } from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  roleName: iamRoleNameSchema,
})

const GetRoleResponseSchema = z.object({
  roleName: z.string(),
  roleId: z.string(),
  arn: z.string(),
  path: z.string(),
  createDate: z.string().nullable(),
  description: z.string().nullable(),
  maxSessionDuration: z.number().nullable(),
  assumeRolePolicyDocument: z.string().nullable(),
  roleLastUsedDate: z.string().nullable(),
  roleLastUsedRegion: z.string().nullable(),
})

export const awsIamGetRoleContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/get-role',
  body: Schema,
  response: { mode: 'json', schema: GetRoleResponseSchema },
})
export type AwsIamGetRoleRequest = ContractBodyInput<typeof awsIamGetRoleContract>
export type AwsIamGetRoleBody = ContractBody<typeof awsIamGetRoleContract>
export type AwsIamGetRoleResponse = ContractJsonResponse<typeof awsIamGetRoleContract>

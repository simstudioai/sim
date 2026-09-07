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

export const awsIamDeleteRoleContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/delete-role',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamDeleteRoleRequest = ContractBodyInput<typeof awsIamDeleteRoleContract>
export type AwsIamDeleteRoleBody = ContractBody<typeof awsIamDeleteRoleContract>
export type AwsIamDeleteRoleResponse = ContractJsonResponse<typeof awsIamDeleteRoleContract>

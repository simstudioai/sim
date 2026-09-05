import { z } from 'zod'
import {
  iamConnectionShape,
  iamGroupNameSchema,
  iamUserName128Schema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  userName: iamUserName128Schema,
  groupName: iamGroupNameSchema,
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

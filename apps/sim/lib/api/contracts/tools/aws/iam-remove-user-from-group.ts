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

export const awsIamRemoveUserFromGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/remove-user-from-group',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamRemoveUserFromGroupRequest = ContractBodyInput<
  typeof awsIamRemoveUserFromGroupContract
>
export type AwsIamRemoveUserFromGroupBody = ContractBody<typeof awsIamRemoveUserFromGroupContract>
export type AwsIamRemoveUserFromGroupResponse = ContractJsonResponse<
  typeof awsIamRemoveUserFromGroupContract
>

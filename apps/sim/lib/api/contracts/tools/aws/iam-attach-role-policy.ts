import { z } from 'zod'
import {
  iamConnectionShape,
  iamPolicyArnSchema,
  iamRoleNameSchema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  roleName: iamRoleNameSchema,
  policyArn: iamPolicyArnSchema,
})

export const awsIamAttachRolePolicyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/attach-role-policy',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamAttachRolePolicyRequest = ContractBodyInput<typeof awsIamAttachRolePolicyContract>
export type AwsIamAttachRolePolicyBody = ContractBody<typeof awsIamAttachRolePolicyContract>
export type AwsIamAttachRolePolicyResponse = ContractJsonResponse<
  typeof awsIamAttachRolePolicyContract
>

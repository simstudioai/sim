import { z } from 'zod'
import {
  iamConnectionShape,
  iamPolicyArnSchema,
  iamUserName64Schema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  userName: iamUserName64Schema,
  policyArn: iamPolicyArnSchema,
})

export const awsIamAttachUserPolicyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/attach-user-policy',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamAttachUserPolicyRequest = ContractBodyInput<typeof awsIamAttachUserPolicyContract>
export type AwsIamAttachUserPolicyBody = ContractBody<typeof awsIamAttachUserPolicyContract>
export type AwsIamAttachUserPolicyResponse = ContractJsonResponse<
  typeof awsIamAttachUserPolicyContract
>

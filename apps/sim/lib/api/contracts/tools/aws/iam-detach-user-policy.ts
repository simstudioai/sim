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

export const awsIamDetachUserPolicyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/detach-user-policy',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamDetachUserPolicyRequest = ContractBodyInput<typeof awsIamDetachUserPolicyContract>
export type AwsIamDetachUserPolicyBody = ContractBody<typeof awsIamDetachUserPolicyContract>
export type AwsIamDetachUserPolicyResponse = ContractJsonResponse<
  typeof awsIamDetachUserPolicyContract
>

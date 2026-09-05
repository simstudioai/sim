import { z } from 'zod'
import { iamConnectionShape, iamPolicyArnSchema } from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  policyArn: iamPolicyArnSchema,
})

const GetPolicyResponseSchema = z.object({
  policyName: z.string(),
  policyId: z.string(),
  arn: z.string(),
  path: z.string(),
  attachmentCount: z.number(),
  isAttachable: z.boolean(),
  createDate: z.string().nullable(),
  updateDate: z.string().nullable(),
  description: z.string().nullable(),
  defaultVersionId: z.string().nullable(),
  permissionsBoundaryUsageCount: z.number(),
  tags: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
})

export const awsIamGetPolicyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/get-policy',
  body: Schema,
  response: { mode: 'json', schema: GetPolicyResponseSchema },
})
export type AwsIamGetPolicyRequest = ContractBodyInput<typeof awsIamGetPolicyContract>
export type AwsIamGetPolicyBody = ContractBody<typeof awsIamGetPolicyContract>
export type AwsIamGetPolicyResponse = ContractJsonResponse<typeof awsIamGetPolicyContract>

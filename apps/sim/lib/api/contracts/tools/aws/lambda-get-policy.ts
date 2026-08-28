import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetPolicySchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  qualifier: z
    .string()
    .min(1, 'qualifier cannot be empty')
    .max(128, 'qualifier cannot exceed 128 characters')
    .optional(),
})

const GetPolicyResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    policy: z.string().nullable(),
    revisionId: z.string().nullable(),
  }),
})

export const awsLambdaGetPolicyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-policy',
  body: GetPolicySchema,
  response: { mode: 'json', schema: GetPolicyResponseSchema },
})
export type AwsLambdaGetPolicyRequest = ContractBodyInput<typeof awsLambdaGetPolicyContract>
export type AwsLambdaGetPolicyBody = ContractBody<typeof awsLambdaGetPolicyContract>
export type AwsLambdaGetPolicyResponse = ContractJsonResponse<typeof awsLambdaGetPolicyContract>

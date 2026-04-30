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
  policySourceArn: z.string().min(1, 'Policy source ARN is required'),
  actionNames: z.string().min(1, 'Action names are required'),
  resourceArns: z.string().optional().nullable(),
  maxResults: z.number().int().min(1).max(1000).optional().nullable(),
  marker: z.string().optional().nullable(),
})

const SimulatePrincipalPolicyResponseSchema = z.object({
  evaluationResults: z.array(
    z.object({
      evalActionName: z.string(),
      evalResourceName: z.string(),
      evalDecision: z.string(),
      matchedStatements: z.array(
        z.object({
          sourcePolicyId: z.string(),
          sourcePolicyType: z.string(),
        })
      ),
      missingContextValues: z.array(z.string()),
    })
  ),
  isTruncated: z.boolean(),
  marker: z.string().nullable(),
  count: z.number(),
})

export const awsIamSimulatePrincipalPolicyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/simulate-principal-policy',
  body: Schema,
  response: { mode: 'json', schema: SimulatePrincipalPolicyResponseSchema },
})
export type AwsIamSimulatePrincipalPolicyRequest = ContractBodyInput<
  typeof awsIamSimulatePrincipalPolicyContract
>
export type AwsIamSimulatePrincipalPolicyBody = ContractBody<
  typeof awsIamSimulatePrincipalPolicyContract
>
export type AwsIamSimulatePrincipalPolicyResponse = ContractJsonResponse<
  typeof awsIamSimulatePrincipalPolicyContract
>

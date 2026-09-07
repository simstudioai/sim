import { z } from 'zod'
import {
  iamActionNamesSchema,
  iamConnectionShape,
  iamContextEntriesSchema,
  iamMarkerSchema,
  iamMaxItemsSchema,
  iamPaginationResponseShape,
  iamPolicySourceArnSchema,
  iamResourceArnsSchema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  policySourceArn: iamPolicySourceArnSchema,
  actionNames: iamActionNamesSchema,
  resourceArns: iamResourceArnsSchema.optional().nullable(),
  contextEntries: iamContextEntriesSchema.optional().nullable(),
  maxResults: iamMaxItemsSchema.optional().nullable(),
  marker: iamMarkerSchema.optional().nullable(),
})

const MatchedStatementSchema = z.object({
  sourcePolicyId: z.string(),
  sourcePolicyType: z.string(),
})

/**
 * The decision for one concrete resource ARN. AWS returns a single evaluation result per
 * action no matter how many resource ARNs were simulated, so per-ARN truth lives only
 * here — and when concrete ARNs are supplied, so do the missing context values.
 */
const ResourceSpecificResultSchema = z.object({
  evalResourceName: z.string(),
  evalResourceDecision: z.string(),
  matchedStatements: z.array(MatchedStatementSchema),
  missingContextValues: z.array(z.string()),
  permissionsBoundaryAllowed: z.boolean().nullable(),
})

const EvaluationResultSchema = z.object({
  evalActionName: z.string(),
  evalResourceName: z.string(),
  evalDecision: z.string(),
  matchedStatements: z.array(MatchedStatementSchema),
  missingContextValues: z.array(z.string()),
  permissionsBoundaryAllowed: z.boolean().nullable(),
  resourceSpecificResults: z.array(ResourceSpecificResultSchema),
})

const SimulatePrincipalPolicyResponseSchema = z.object({
  evaluationResults: z.array(EvaluationResultSchema),
  ...iamPaginationResponseShape,
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

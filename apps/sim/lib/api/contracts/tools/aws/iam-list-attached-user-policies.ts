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
  userName: z.string().min(1, 'User name is required'),
  pathPrefix: z.string().optional().nullable(),
  maxItems: z.number().int().min(1).max(1000).optional().nullable(),
  marker: z.string().optional().nullable(),
})

const ListAttachedUserPoliciesResponseSchema = z.object({
  attachedPolicies: z.array(
    z.object({
      policyName: z.string(),
      policyArn: z.string(),
    })
  ),
  isTruncated: z.boolean(),
  marker: z.string().nullable(),
  count: z.number(),
})

export const awsIamListAttachedUserPoliciesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-attached-user-policies',
  body: Schema,
  response: { mode: 'json', schema: ListAttachedUserPoliciesResponseSchema },
})
export type AwsIamListAttachedUserPoliciesRequest = ContractBodyInput<
  typeof awsIamListAttachedUserPoliciesContract
>
export type AwsIamListAttachedUserPoliciesBody = ContractBody<
  typeof awsIamListAttachedUserPoliciesContract
>
export type AwsIamListAttachedUserPoliciesResponse = ContractJsonResponse<
  typeof awsIamListAttachedUserPoliciesContract
>

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
  roleName: z.string().min(1, 'Role name is required'),
  pathPrefix: z.string().optional().nullable(),
  maxItems: z.number().int().min(1).max(1000).optional().nullable(),
  marker: z.string().optional().nullable(),
})

const ListAttachedRolePoliciesResponseSchema = z.object({
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

export const awsIamListAttachedRolePoliciesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-attached-role-policies',
  body: Schema,
  response: { mode: 'json', schema: ListAttachedRolePoliciesResponseSchema },
})
export type AwsIamListAttachedRolePoliciesRequest = ContractBodyInput<
  typeof awsIamListAttachedRolePoliciesContract
>
export type AwsIamListAttachedRolePoliciesBody = ContractBody<
  typeof awsIamListAttachedRolePoliciesContract
>
export type AwsIamListAttachedRolePoliciesResponse = ContractJsonResponse<
  typeof awsIamListAttachedRolePoliciesContract
>

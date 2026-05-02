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
  scope: z.string().optional().nullable(),
  onlyAttached: z.boolean().optional().nullable(),
  pathPrefix: z.string().optional().nullable(),
  maxItems: z.number().int().min(1).max(1000).optional().nullable(),
  marker: z.string().optional().nullable(),
})

const ListPoliciesResponseSchema = z.object({
  policies: z.array(
    z.object({
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
    })
  ),
  isTruncated: z.boolean(),
  marker: z.string().nullable(),
  count: z.number(),
})

export const awsIamListPoliciesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-policies',
  body: Schema,
  response: { mode: 'json', schema: ListPoliciesResponseSchema },
})
export type AwsIamListPoliciesRequest = ContractBodyInput<typeof awsIamListPoliciesContract>
export type AwsIamListPoliciesBody = ContractBody<typeof awsIamListPoliciesContract>
export type AwsIamListPoliciesResponse = ContractJsonResponse<typeof awsIamListPoliciesContract>

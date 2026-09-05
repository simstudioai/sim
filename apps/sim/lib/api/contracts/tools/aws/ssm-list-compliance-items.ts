import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ComplianceStringFilterSchema = z.object({
  Key: z.string().min(1).max(200).optional(),
  Values: z.array(z.string().min(1)).min(1).max(20).optional(),
  Type: z.enum(['EQUAL', 'NOT_EQUAL', 'BEGIN_WITH', 'LESS_THAN', 'GREATER_THAN']).optional(),
})

const ComplianceItemSchema = z.object({
  complianceType: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  id: z.string(),
  title: z.string(),
  status: z.string(),
  severity: z.string(),
  executionTime: z.string().nullable(),
  executionId: z.string().nullable(),
  executionType: z.string().nullable(),
  details: z.record(z.string(), z.string()).nullable(),
})

const RequestSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceIds: z.array(z.string().min(1)).max(1).nullish(),
  resourceTypes: z.array(z.string().min(1)).max(1).nullish(),
  filters: z.array(ComplianceStringFilterSchema).nullish(),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  complianceItems: z.array(ComplianceItemSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmListComplianceItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/list-compliance-items',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmListComplianceItemsRequest = ContractBodyInput<
  typeof awsSsmListComplianceItemsContract
>
export type AwsSsmListComplianceItemsBody = ContractBody<typeof awsSsmListComplianceItemsContract>
export type AwsSsmListComplianceItemsResponse = ContractJsonResponse<
  typeof awsSsmListComplianceItemsContract
>

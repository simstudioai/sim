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

const SeveritySummarySchema = z.object({
  criticalCount: z.number().nullable(),
  highCount: z.number().nullable(),
  mediumCount: z.number().nullable(),
  lowCount: z.number().nullable(),
  informationalCount: z.number().nullable(),
  unspecifiedCount: z.number().nullable(),
})

const ComplianceSummaryItemSchema = z.object({
  complianceType: z.string(),
  compliantCount: z.number().nullable(),
  compliantSeveritySummary: SeveritySummarySchema.nullable(),
  nonCompliantCount: z.number().nullable(),
  nonCompliantSeveritySummary: SeveritySummarySchema.nullable(),
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
  filters: z.array(ComplianceStringFilterSchema).nullish(),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  complianceSummaryItems: z.array(ComplianceSummaryItemSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmListComplianceSummariesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/list-compliance-summaries',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmListComplianceSummariesRequest = ContractBodyInput<
  typeof awsSsmListComplianceSummariesContract
>
export type AwsSsmListComplianceSummariesBody = ContractBody<
  typeof awsSsmListComplianceSummariesContract
>
export type AwsSsmListComplianceSummariesResponse = ContractJsonResponse<
  typeof awsSsmListComplianceSummariesContract
>

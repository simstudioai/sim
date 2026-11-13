import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ScanSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    tableName: z.string().min(1, 'Table name is required'),
    filterExpression: z.string().optional(),
    projectionExpression: z.string().optional(),
    expressionAttributeNames: z.record(z.string(), z.string()).optional(),
    expressionAttributeValues: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().positive().optional(),
    exclusiveStartKey: z.record(z.string(), z.unknown()).optional(),
    indexName: z.string().optional(),
    consistentRead: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .transform((val) => {
        if (val === true || val === 'true') return true
        return undefined
      }),
    segment: z.number().int().min(0).max(999999).optional(),
    totalSegments: z.number().int().min(1).max(1000000).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.segment === undefined) !== (value.totalSegments === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['segment'],
        message: 'Segment and Total Segments must be set together for a parallel scan',
      })
    } else if (
      value.segment !== undefined &&
      value.totalSegments !== undefined &&
      value.segment >= value.totalSegments
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['segment'],
        message: 'Segment must be less than Total Segments',
      })
    }
  })

const ScanResponseSchema = z.object({
  message: z.string(),
  // untyped-response: DynamoDB Items are arbitrary user attribute-value records
  items: z.array(z.record(z.string(), z.unknown())),
  count: z.number(),
  scannedCount: z.number().nullable(),
  // untyped-response: DynamoDB LastEvaluatedKey mirrors the table's primary key shape
  lastEvaluatedKey: z.record(z.string(), z.unknown()).optional(),
})

export const awsDynamodbScanContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/dynamodb/scan',
  body: ScanSchema,
  response: { mode: 'json', schema: ScanResponseSchema },
})
export type AwsDynamodbScanRequest = ContractBodyInput<typeof awsDynamodbScanContract>
export type AwsDynamodbScanBody = ContractBody<typeof awsDynamodbScanContract>
export type AwsDynamodbScanResponse = ContractJsonResponse<typeof awsDynamodbScanContract>

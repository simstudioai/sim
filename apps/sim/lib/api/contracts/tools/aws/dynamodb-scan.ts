import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ScanSchema = z.object({
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
})

const ScanResponseSchema = z.object({
  message: z.string(),
  // untyped-response: DynamoDB Items are arbitrary user attribute-value records
  items: z.array(z.record(z.string(), z.unknown())),
  count: z.number(),
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

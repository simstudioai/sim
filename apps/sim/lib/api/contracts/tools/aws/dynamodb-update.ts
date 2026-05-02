import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const UpdateSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().min(1, 'Table name is required'),
  key: z.record(z.string(), z.unknown()).refine((val) => Object.keys(val).length > 0, {
    message: 'Key is required',
  }),
  updateExpression: z.string().min(1, 'Update expression is required'),
  expressionAttributeNames: z.record(z.string(), z.string()).optional(),
  expressionAttributeValues: z.record(z.string(), z.unknown()).optional(),
  conditionExpression: z.string().optional(),
})

const UpdateResponseSchema = z.object({
  message: z.string(),
  // untyped-response: DynamoDB UpdateItem Attributes is an arbitrary user attribute-value record
  item: z.record(z.string(), z.unknown()).nullable(),
})

export const awsDynamodbUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/dynamodb/update',
  body: UpdateSchema,
  response: { mode: 'json', schema: UpdateResponseSchema },
})
export type AwsDynamodbUpdateRequest = ContractBodyInput<typeof awsDynamodbUpdateContract>
export type AwsDynamodbUpdateBody = ContractBody<typeof awsDynamodbUpdateContract>
export type AwsDynamodbUpdateResponse = ContractJsonResponse<typeof awsDynamodbUpdateContract>

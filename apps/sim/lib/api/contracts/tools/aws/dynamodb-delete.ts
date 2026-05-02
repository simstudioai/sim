import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DeleteSchema = z.object({
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
  conditionExpression: z.string().optional(),
  expressionAttributeNames: z.record(z.string(), z.string()).optional(),
  expressionAttributeValues: z.record(z.string(), z.unknown()).optional(),
})

const DeleteResponseSchema = z.object({
  message: z.string(),
})

export const awsDynamodbDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/dynamodb/delete',
  body: DeleteSchema,
  response: { mode: 'json', schema: DeleteResponseSchema },
})
export type AwsDynamodbDeleteRequest = ContractBodyInput<typeof awsDynamodbDeleteContract>
export type AwsDynamodbDeleteBody = ContractBody<typeof awsDynamodbDeleteContract>
export type AwsDynamodbDeleteResponse = ContractJsonResponse<typeof awsDynamodbDeleteContract>

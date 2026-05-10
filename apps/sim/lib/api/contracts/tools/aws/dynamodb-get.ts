import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetSchema = z.object({
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
  consistentRead: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === true || val === 'true') return true
      return undefined
    }),
})

const GetResponseSchema = z.object({
  message: z.string(),
  // untyped-response: DynamoDB Item is an arbitrary user attribute-value record
  item: z.record(z.string(), z.unknown()).nullable(),
})

export const awsDynamodbGetContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/dynamodb/get',
  body: GetSchema,
  response: { mode: 'json', schema: GetResponseSchema },
})
export type AwsDynamodbGetRequest = ContractBodyInput<typeof awsDynamodbGetContract>
export type AwsDynamodbGetBody = ContractBody<typeof awsDynamodbGetContract>
export type AwsDynamodbGetResponse = ContractJsonResponse<typeof awsDynamodbGetContract>

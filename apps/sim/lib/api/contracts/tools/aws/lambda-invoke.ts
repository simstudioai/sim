import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const InvokeSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  payload: z.unknown().optional(),
  invocationType: z.enum(['RequestResponse', 'Event', 'DryRun']).optional(),
  logType: z.enum(['None', 'Tail']).optional(),
  clientContext: z
    .string()
    .max(3583, 'clientContext cannot exceed 3583 bytes of base64 data')
    .optional(),
  qualifier: z
    .string()
    .min(1, 'qualifier cannot be empty')
    .max(128, 'qualifier cannot exceed 128 characters')
    .optional(),
})

const InvokeResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    statusCode: z.number().nullable(),
    payload: z.unknown(),
    functionError: z.string().nullable(),
    logResult: z.string().nullable(),
    executedVersion: z.string().nullable(),
  }),
})

export const awsLambdaInvokeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/invoke',
  body: InvokeSchema,
  response: { mode: 'json', schema: InvokeResponseSchema },
})
export type AwsLambdaInvokeRequest = ContractBodyInput<typeof awsLambdaInvokeContract>
export type AwsLambdaInvokeBody = ContractBody<typeof awsLambdaInvokeContract>
export type AwsLambdaInvokeResponse = ContractJsonResponse<typeof awsLambdaInvokeContract>

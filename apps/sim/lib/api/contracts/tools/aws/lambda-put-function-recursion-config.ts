import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const PutFunctionRecursionConfigSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  recursiveLoop: z.enum(['Allow', 'Terminate']),
})

const PutFunctionRecursionConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    recursiveLoop: z.string().nullable(),
  }),
})

export const awsLambdaPutFunctionRecursionConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/put-function-recursion-config',
  body: PutFunctionRecursionConfigSchema,
  response: { mode: 'json', schema: PutFunctionRecursionConfigResponseSchema },
})
export type AwsLambdaPutFunctionRecursionConfigRequest = ContractBodyInput<
  typeof awsLambdaPutFunctionRecursionConfigContract
>
export type AwsLambdaPutFunctionRecursionConfigBody = ContractBody<
  typeof awsLambdaPutFunctionRecursionConfigContract
>
export type AwsLambdaPutFunctionRecursionConfigResponse = ContractJsonResponse<
  typeof awsLambdaPutFunctionRecursionConfigContract
>

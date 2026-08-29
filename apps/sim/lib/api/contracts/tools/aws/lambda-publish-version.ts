import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaFunctionConfigurationSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const PublishVersionSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  codeSha256: z.string().min(1, 'codeSha256 cannot be empty').optional(),
  description: z.string().max(256, 'description cannot exceed 256 characters').optional(),
  revisionId: z.string().min(1, 'revisionId cannot be empty').optional(),
})

const PublishVersionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    configuration: lambdaFunctionConfigurationSchema,
  }),
})

export const awsLambdaPublishVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/publish-version',
  body: PublishVersionSchema,
  response: { mode: 'json', schema: PublishVersionResponseSchema },
})
export type AwsLambdaPublishVersionRequest = ContractBodyInput<
  typeof awsLambdaPublishVersionContract
>
export type AwsLambdaPublishVersionBody = ContractBody<typeof awsLambdaPublishVersionContract>
export type AwsLambdaPublishVersionResponse = ContractJsonResponse<
  typeof awsLambdaPublishVersionContract
>

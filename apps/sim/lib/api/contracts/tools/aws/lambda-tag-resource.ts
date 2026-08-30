import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaMessageResponseSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const TagResourceSchema = z.object({
  ...lambdaConnectionFields,
  resourceArn: z.string().min(1, 'resourceArn is required'),
  tags: z
    .record(z.string().min(1, 'a tag key cannot be empty'), z.string())
    .refine((tags) => Object.keys(tags).length > 0, 'tags must contain at least one entry'),
})

const TagResourceResponseSchema = lambdaMessageResponseSchema

export const awsLambdaTagResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/tag-resource',
  body: TagResourceSchema,
  response: { mode: 'json', schema: TagResourceResponseSchema },
})
export type AwsLambdaTagResourceRequest = ContractBodyInput<typeof awsLambdaTagResourceContract>
export type AwsLambdaTagResourceBody = ContractBody<typeof awsLambdaTagResourceContract>
export type AwsLambdaTagResourceResponse = ContractJsonResponse<typeof awsLambdaTagResourceContract>

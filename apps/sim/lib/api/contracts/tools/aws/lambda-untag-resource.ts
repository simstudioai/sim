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

const UntagResourceSchema = z.object({
  ...lambdaConnectionFields,
  resourceArn: z.string().min(1, 'resourceArn is required'),
  tagKeys: z
    .array(z.string().min(1, 'a tag key cannot be empty'))
    .min(1, 'tagKeys must contain at least one key'),
})

const UntagResourceResponseSchema = lambdaMessageResponseSchema

export const awsLambdaUntagResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/untag-resource',
  body: UntagResourceSchema,
  response: { mode: 'json', schema: UntagResourceResponseSchema },
})
export type AwsLambdaUntagResourceRequest = ContractBodyInput<typeof awsLambdaUntagResourceContract>
export type AwsLambdaUntagResourceBody = ContractBody<typeof awsLambdaUntagResourceContract>
export type AwsLambdaUntagResourceResponse = ContractJsonResponse<
  typeof awsLambdaUntagResourceContract
>

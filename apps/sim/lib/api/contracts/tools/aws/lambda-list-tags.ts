import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListTagsSchema = z.object({
  ...lambdaConnectionFields,
  resourceArn: z.string().min(1, 'resourceArn is required'),
})

const ListTagsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    tags: z.record(z.string(), z.string()),
  }),
})

export const awsLambdaListTagsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-tags',
  body: ListTagsSchema,
  response: { mode: 'json', schema: ListTagsResponseSchema },
})
export type AwsLambdaListTagsRequest = ContractBodyInput<typeof awsLambdaListTagsContract>
export type AwsLambdaListTagsBody = ContractBody<typeof awsLambdaListTagsContract>
export type AwsLambdaListTagsResponse = ContractJsonResponse<typeof awsLambdaListTagsContract>

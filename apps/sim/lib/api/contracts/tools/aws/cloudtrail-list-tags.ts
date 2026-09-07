import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListTagsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceIdList: z
    .array(
      z
        .string()
        .trim()
        .regex(
          /^arn:aws[a-zA-Z0-9-]*:cloudtrail:[a-z0-9-]+:\d{12}:(?:trail|eventdatastore|dashboard|channel)\/[\w.\-/]+$/,
          'Must be a CloudTrail trail, event data store, dashboard, or channel ARN'
        )
    )
    .min(1, 'At least one resource ARN is required')
    .max(20, 'A maximum of 20 resource ARNs can be requested at once'),
  nextToken: z.string().optional(),
})

const ListTagsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    resourceTags: z.array(
      z.object({
        resourceId: z.string().nullable(),
        tags: z.array(z.object({ key: z.string(), value: z.string().nullable() })),
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsCloudtrailListTagsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/list-tags',
  body: ListTagsSchema,
  response: { mode: 'json', schema: ListTagsResponseSchema },
})
export type AwsCloudtrailListTagsRequest = ContractBodyInput<typeof awsCloudtrailListTagsContract>
export type AwsCloudtrailListTagsBody = ContractBody<typeof awsCloudtrailListTagsContract>
export type AwsCloudtrailListTagsResponse = ContractJsonResponse<
  typeof awsCloudtrailListTagsContract
>

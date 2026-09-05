import { z } from 'zod'
import { cloudtrailTrailNameOrArnSchema } from '@/lib/api/contracts/tools/aws/cloudtrail-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/**
 * The ARN, or the ID suffix of the ARN, of a CloudTrail Lake event data store.
 * @see https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_GetEventDataStore.html
 */
const eventDataStoreSchema = z
  .string()
  .trim()
  .min(3, 'Event data store ARN or ID is required')
  .max(256, 'Event data store ARN or ID is too long')
  .regex(/^[a-zA-Z0-9._/\-:]+$/, 'Invalid event data store ARN or ID')

const GetInsightSelectorsSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    trailName: cloudtrailTrailNameOrArnSchema.optional(),
    eventDataStore: eventDataStoreSchema.optional(),
  })
  .refine((v) => Boolean(v.trailName) !== Boolean(v.eventDataStore), {
    message: 'Specify exactly one of trailName or eventDataStore',
    path: ['trailName'],
  })

const GetInsightSelectorsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    trailArn: z.string().nullable(),
    eventDataStoreArn: z.string().nullable(),
    insightsDestination: z.string().nullable(),
    insightSelectors: z.array(
      z.object({
        insightType: z.string().nullable(),
        eventCategories: z.array(z.string()),
      })
    ),
  }),
})

export const awsCloudtrailGetInsightSelectorsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/get-insight-selectors',
  body: GetInsightSelectorsSchema,
  response: { mode: 'json', schema: GetInsightSelectorsResponseSchema },
})
export type AwsCloudtrailGetInsightSelectorsRequest = ContractBodyInput<
  typeof awsCloudtrailGetInsightSelectorsContract
>
export type AwsCloudtrailGetInsightSelectorsBody = ContractBody<
  typeof awsCloudtrailGetInsightSelectorsContract
>
export type AwsCloudtrailGetInsightSelectorsResponse = ContractJsonResponse<
  typeof awsCloudtrailGetInsightSelectorsContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/**
 * A trail name (3-128 chars, ASCII alphanumerics plus non-adjacent `.`, `_`, `-`,
 * starting and ending alphanumeric) or a full trail ARN. Shadow trails and
 * organization trails in another Region can only be addressed by ARN.
 * @see https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_GetTrail.html
 */
const trailNameOrArnSchema = z
  .string()
  .trim()
  .min(3, 'Trail name must be at least 3 characters')
  .max(256, 'Trail name or ARN is too long')
  .regex(
    /^(?:arn:aws[a-zA-Z0-9-]*:cloudtrail:[a-z0-9-]+:\d{12}:trail\/[\w.\-/]+|[a-zA-Z0-9](?:[._-]?[a-zA-Z0-9]+)+)$/,
    'Must be a valid trail name or trail ARN'
  )

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
    trailName: trailNameOrArnSchema.optional(),
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

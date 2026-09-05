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

const advancedEventSelectorSchema = z.object({
  name: z.string().nullable(),
  fieldSelectors: z.array(
    z.object({
      field: z.string(),
      equals: z.array(z.string()),
      startsWith: z.array(z.string()),
      endsWith: z.array(z.string()),
      notEquals: z.array(z.string()),
      notStartsWith: z.array(z.string()),
      notEndsWith: z.array(z.string()),
    })
  ),
})

const GetEventSelectorsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  trailName: trailNameOrArnSchema,
})

const GetEventSelectorsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    trailArn: z.string().nullable(),
    eventSelectors: z.array(
      z.object({
        readWriteType: z.string().nullable(),
        includeManagementEvents: z.boolean().nullable(),
        dataResources: z.array(
          z.object({
            type: z.string().nullable(),
            values: z.array(z.string()),
          })
        ),
        excludeManagementEventSources: z.array(z.string()),
      })
    ),
    advancedEventSelectors: z.array(advancedEventSelectorSchema),
  }),
})

export const awsCloudtrailGetEventSelectorsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/get-event-selectors',
  body: GetEventSelectorsSchema,
  response: { mode: 'json', schema: GetEventSelectorsResponseSchema },
})
export type AwsCloudtrailGetEventSelectorsRequest = ContractBodyInput<
  typeof awsCloudtrailGetEventSelectorsContract
>
export type AwsCloudtrailGetEventSelectorsBody = ContractBody<
  typeof awsCloudtrailGetEventSelectorsContract
>
export type AwsCloudtrailGetEventSelectorsResponse = ContractJsonResponse<
  typeof awsCloudtrailGetEventSelectorsContract
>

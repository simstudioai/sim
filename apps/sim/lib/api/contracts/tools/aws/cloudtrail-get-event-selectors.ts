import { z } from 'zod'
import { cloudtrailTrailNameOrArnSchema } from '@/lib/api/contracts/tools/aws/cloudtrail-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

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
  trailName: cloudtrailTrailNameOrArnSchema,
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

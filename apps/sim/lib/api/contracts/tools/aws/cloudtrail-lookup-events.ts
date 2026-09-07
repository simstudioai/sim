import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const LookupEventsSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    attributeKey: z
      .enum([
        'AccessKeyId',
        'EventId',
        'EventName',
        'EventSource',
        'ReadOnly',
        'ResourceName',
        'ResourceType',
        'Username',
      ])
      .optional(),
    attributeValue: z
      .string()
      .trim()
      .min(1, 'Lookup attribute value cannot be empty')
      .max(2000, 'Lookup attribute value cannot exceed 2000 characters')
      .optional(),
    startTime: z.string().datetime({ offset: true }).optional(),
    endTime: z.string().datetime({ offset: true }).optional(),
    eventCategory: z.literal('insight').optional(),
    maxResults: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.coerce.number().int().min(1).max(50).optional()
    ),
    nextToken: z.string().optional(),
  })
  .refine((v) => (v.attributeKey === undefined) === (v.attributeValue === undefined), {
    message: 'attributeKey and attributeValue must be provided together',
    path: ['attributeValue'],
  })

const LookupEventsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    events: z.array(
      z.object({
        eventId: z.string().nullable(),
        eventName: z.string().nullable(),
        readOnly: z.string().nullable(),
        accessKeyId: z.string().nullable(),
        eventTime: z.string().nullable(),
        eventSource: z.string().nullable(),
        username: z.string().nullable(),
        resources: z.array(
          z.object({
            resourceType: z.string().nullable(),
            resourceName: z.string().nullable(),
          })
        ),
        cloudTrailEvent: z.record(z.string(), z.unknown()).nullable(),
        cloudTrailEventRaw: z.string().nullable(),
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsCloudtrailLookupEventsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/lookup-events',
  body: LookupEventsSchema,
  response: { mode: 'json', schema: LookupEventsResponseSchema },
})
export type AwsCloudtrailLookupEventsRequest = ContractBodyInput<
  typeof awsCloudtrailLookupEventsContract
>
export type AwsCloudtrailLookupEventsBody = ContractBody<typeof awsCloudtrailLookupEventsContract>
export type AwsCloudtrailLookupEventsResponse = ContractJsonResponse<
  typeof awsCloudtrailLookupEventsContract
>

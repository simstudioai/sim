import { z } from 'zod'
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

const GetEventDataStoreSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  eventDataStore: z
    .string()
    .trim()
    .min(3, 'Event data store ARN or ID is required')
    .max(256)
    .regex(/^[a-zA-Z0-9._/\-:]+$/, 'Invalid event data store ARN or ID'),
})

const GetEventDataStoreResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventDataStoreArn: z.string().nullable(),
    name: z.string().nullable(),
    status: z.string().nullable(),
    advancedEventSelectors: z.array(advancedEventSelectorSchema),
    multiRegionEnabled: z.boolean().nullable(),
    organizationEnabled: z.boolean().nullable(),
    retentionPeriod: z.number().nullable(),
    terminationProtectionEnabled: z.boolean().nullable(),
    createdTimestamp: z.string().nullable(),
    updatedTimestamp: z.string().nullable(),
    kmsKeyId: z.string().nullable(),
    billingMode: z.string().nullable(),
    federationStatus: z.string().nullable(),
    federationRoleArn: z.string().nullable(),
    partitionKeys: z.array(z.object({ name: z.string(), type: z.string() })),
  }),
})

export const awsCloudtrailGetEventDataStoreContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/get-event-data-store',
  body: GetEventDataStoreSchema,
  response: { mode: 'json', schema: GetEventDataStoreResponseSchema },
})
export type AwsCloudtrailGetEventDataStoreRequest = ContractBodyInput<
  typeof awsCloudtrailGetEventDataStoreContract
>
export type AwsCloudtrailGetEventDataStoreBody = ContractBody<
  typeof awsCloudtrailGetEventDataStoreContract
>
export type AwsCloudtrailGetEventDataStoreResponse = ContractJsonResponse<
  typeof awsCloudtrailGetEventDataStoreContract
>

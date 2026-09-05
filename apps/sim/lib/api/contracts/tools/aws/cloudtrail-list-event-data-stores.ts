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

const ListEventDataStoresSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(1000).optional()
  ),
  nextToken: z.string().min(4).max(1000).optional(),
})

const ListEventDataStoresResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventDataStores: z.array(
      z.object({
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
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsCloudtrailListEventDataStoresContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/list-event-data-stores',
  body: ListEventDataStoresSchema,
  response: { mode: 'json', schema: ListEventDataStoresResponseSchema },
})
export type AwsCloudtrailListEventDataStoresRequest = ContractBodyInput<
  typeof awsCloudtrailListEventDataStoresContract
>
export type AwsCloudtrailListEventDataStoresBody = ContractBody<
  typeof awsCloudtrailListEventDataStoresContract
>
export type AwsCloudtrailListEventDataStoresResponse = ContractJsonResponse<
  typeof awsCloudtrailListEventDataStoresContract
>

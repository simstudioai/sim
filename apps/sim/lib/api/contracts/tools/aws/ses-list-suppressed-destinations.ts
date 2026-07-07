import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListSuppressedDestinationsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  reasons: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  pageSize: z.number().int().min(1).max(1000).nullish(),
  nextToken: z.string().nullish(),
})

const ListSuppressedDestinationsResponseSchema = z.object({
  destinations: z.array(
    z.object({
      emailAddress: z.string(),
      reason: z.string(),
      lastUpdateTime: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSesListSuppressedDestinationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/list-suppressed-destinations',
  body: ListSuppressedDestinationsSchema,
  response: { mode: 'json', schema: ListSuppressedDestinationsResponseSchema },
})
export type AwsSesListSuppressedDestinationsRequest = ContractBodyInput<
  typeof awsSesListSuppressedDestinationsContract
>
export type AwsSesListSuppressedDestinationsBody = ContractBody<
  typeof awsSesListSuppressedDestinationsContract
>
export type AwsSesListSuppressedDestinationsResponse = ContractJsonResponse<
  typeof awsSesListSuppressedDestinationsContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListApplicationsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ApplicationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
})

const ListApplicationsResponseSchema = z.object({
  applications: z.array(ApplicationSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsAppConfigListApplicationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/list-applications',
  body: ListApplicationsSchema,
  response: { mode: 'json', schema: ListApplicationsResponseSchema },
})
export type AwsAppConfigListApplicationsRequest = ContractBodyInput<
  typeof awsAppConfigListApplicationsContract
>
export type AwsAppConfigListApplicationsBody = ContractBody<
  typeof awsAppConfigListApplicationsContract
>
export type AwsAppConfigListApplicationsResponse = ContractJsonResponse<
  typeof awsAppConfigListApplicationsContract
>

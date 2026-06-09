import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListEnvironmentsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const EnvironmentSchema = z.object({
  applicationId: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  state: z.string().nullable(),
})

const ListEnvironmentsResponseSchema = z.object({
  environments: z.array(EnvironmentSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsAppConfigListEnvironmentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/list-environments',
  body: ListEnvironmentsSchema,
  response: { mode: 'json', schema: ListEnvironmentsResponseSchema },
})
export type AwsAppConfigListEnvironmentsRequest = ContractBodyInput<
  typeof awsAppConfigListEnvironmentsContract
>
export type AwsAppConfigListEnvironmentsBody = ContractBody<
  typeof awsAppConfigListEnvironmentsContract
>
export type AwsAppConfigListEnvironmentsResponse = ContractJsonResponse<
  typeof awsAppConfigListEnvironmentsContract
>

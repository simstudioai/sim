import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListHostedConfigurationVersionsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const HostedConfigurationVersionSummarySchema = z.object({
  applicationId: z.string().nullable(),
  configurationProfileId: z.string().nullable(),
  versionNumber: z.number().nullable(),
  description: z.string().nullable(),
  contentType: z.string().nullable(),
  versionLabel: z.string().nullable(),
})

const ListHostedConfigurationVersionsResponseSchema = z.object({
  versions: z.array(HostedConfigurationVersionSummarySchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsAppConfigListHostedConfigurationVersionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/list-hosted-configuration-versions',
  body: ListHostedConfigurationVersionsSchema,
  response: { mode: 'json', schema: ListHostedConfigurationVersionsResponseSchema },
})
export type AwsAppConfigListHostedConfigurationVersionsRequest = ContractBodyInput<
  typeof awsAppConfigListHostedConfigurationVersionsContract
>
export type AwsAppConfigListHostedConfigurationVersionsBody = ContractBody<
  typeof awsAppConfigListHostedConfigurationVersionsContract
>
export type AwsAppConfigListHostedConfigurationVersionsResponse = ContractJsonResponse<
  typeof awsAppConfigListHostedConfigurationVersionsContract
>

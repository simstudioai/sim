import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListConfigurationProfilesSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ConfigurationProfileSchema = z.object({
  applicationId: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  locationUri: z.string().nullable(),
  retrievalRoleArn: z.string().nullable(),
  type: z.string().nullable(),
  validatorTypes: z.array(z.string()),
})

const ListConfigurationProfilesResponseSchema = z.object({
  configurationProfiles: z.array(ConfigurationProfileSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsAppConfigListConfigurationProfilesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/list-configuration-profiles',
  body: ListConfigurationProfilesSchema,
  response: { mode: 'json', schema: ListConfigurationProfilesResponseSchema },
})
export type AwsAppConfigListConfigurationProfilesRequest = ContractBodyInput<
  typeof awsAppConfigListConfigurationProfilesContract
>
export type AwsAppConfigListConfigurationProfilesBody = ContractBody<
  typeof awsAppConfigListConfigurationProfilesContract
>
export type AwsAppConfigListConfigurationProfilesResponse = ContractJsonResponse<
  typeof awsAppConfigListConfigurationProfilesContract
>

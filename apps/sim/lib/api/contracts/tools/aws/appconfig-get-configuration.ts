import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetConfigurationSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID or name is required'),
  environmentId: z.string().min(1, 'Environment ID or name is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID or name is required'),
})

const GetConfigurationResponseSchema = z.object({
  configuration: z.string(),
  contentType: z.string().nullable(),
  versionLabel: z.string().nullable(),
})

export const awsAppConfigGetConfigurationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/get-configuration',
  body: GetConfigurationSchema,
  response: { mode: 'json', schema: GetConfigurationResponseSchema },
})
export type AwsAppConfigGetConfigurationRequest = ContractBodyInput<
  typeof awsAppConfigGetConfigurationContract
>
export type AwsAppConfigGetConfigurationBody = ContractBody<
  typeof awsAppConfigGetConfigurationContract
>
export type AwsAppConfigGetConfigurationResponse = ContractJsonResponse<
  typeof awsAppConfigGetConfigurationContract
>

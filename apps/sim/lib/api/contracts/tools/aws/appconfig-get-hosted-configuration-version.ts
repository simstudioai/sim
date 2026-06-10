import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetHostedConfigurationVersionSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
  versionNumber: z.number().int().min(1, 'Version number is required'),
})

const GetHostedConfigurationVersionResponseSchema = z.object({
  applicationId: z.string(),
  configurationProfileId: z.string(),
  versionNumber: z.number().nullable(),
  description: z.string().nullable(),
  content: z.string(),
  contentType: z.string().nullable(),
  versionLabel: z.string().nullable(),
})

export const awsAppConfigGetHostedConfigurationVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/get-hosted-configuration-version',
  body: GetHostedConfigurationVersionSchema,
  response: { mode: 'json', schema: GetHostedConfigurationVersionResponseSchema },
})
export type AwsAppConfigGetHostedConfigurationVersionRequest = ContractBodyInput<
  typeof awsAppConfigGetHostedConfigurationVersionContract
>
export type AwsAppConfigGetHostedConfigurationVersionBody = ContractBody<
  typeof awsAppConfigGetHostedConfigurationVersionContract
>
export type AwsAppConfigGetHostedConfigurationVersionResponse = ContractJsonResponse<
  typeof awsAppConfigGetHostedConfigurationVersionContract
>

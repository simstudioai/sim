import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteHostedConfigurationVersionSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
  versionNumber: z.number().int().min(1, 'Version number is required'),
})

const DeleteHostedConfigurationVersionResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string(),
  configurationProfileId: z.string(),
  versionNumber: z.number(),
})

export const awsAppConfigDeleteHostedConfigurationVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/delete-hosted-configuration-version',
  body: DeleteHostedConfigurationVersionSchema,
  response: { mode: 'json', schema: DeleteHostedConfigurationVersionResponseSchema },
})
export type AwsAppConfigDeleteHostedConfigurationVersionRequest = ContractBodyInput<
  typeof awsAppConfigDeleteHostedConfigurationVersionContract
>
export type AwsAppConfigDeleteHostedConfigurationVersionBody = ContractBody<
  typeof awsAppConfigDeleteHostedConfigurationVersionContract
>
export type AwsAppConfigDeleteHostedConfigurationVersionResponse = ContractJsonResponse<
  typeof awsAppConfigDeleteHostedConfigurationVersionContract
>

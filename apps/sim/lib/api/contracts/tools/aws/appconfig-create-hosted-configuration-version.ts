import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateHostedConfigurationVersionSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
  content: z.string().min(1, 'Content is required'),
  contentType: z.string().min(1, 'Content type is required').max(255),
  description: z.string().max(1024).nullish(),
  latestVersionNumber: z.number().int().min(0).nullish(),
  versionLabel: z.string().max(64).nullish(),
})

const CreateHostedConfigurationVersionResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string(),
  configurationProfileId: z.string(),
  versionNumber: z.number().nullable(),
  contentType: z.string().nullable(),
  versionLabel: z.string().nullable(),
})

export const awsAppConfigCreateHostedConfigurationVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/create-hosted-configuration-version',
  body: CreateHostedConfigurationVersionSchema,
  response: { mode: 'json', schema: CreateHostedConfigurationVersionResponseSchema },
})
export type AwsAppConfigCreateHostedConfigurationVersionRequest = ContractBodyInput<
  typeof awsAppConfigCreateHostedConfigurationVersionContract
>
export type AwsAppConfigCreateHostedConfigurationVersionBody = ContractBody<
  typeof awsAppConfigCreateHostedConfigurationVersionContract
>
export type AwsAppConfigCreateHostedConfigurationVersionResponse = ContractJsonResponse<
  typeof awsAppConfigCreateHostedConfigurationVersionContract
>

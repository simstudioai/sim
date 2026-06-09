import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const Schema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
  content: z.string().min(1, 'Configuration content is required'),
  contentType: z.string().min(1, 'Content type is required'),
  description: z.string().optional().nullable(),
  versionLabel: z.string().optional().nullable(),
  latestVersionNumber: z.number().int().optional().nullable(),
})

const ResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string().nullable(),
  configurationProfileId: z.string().nullable(),
  versionNumber: z.number().nullable(),
  contentType: z.string().nullable(),
  description: z.string().nullable(),
  versionLabel: z.string().nullable(),
})

export const awsAppConfigCreateHostedConfigurationVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/create-hosted-configuration-version',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
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

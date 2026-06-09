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
  versionNumber: z.number().int().min(1, 'Version number is required'),
})

const ResponseSchema = z.object({
  applicationId: z.string().nullable(),
  configurationProfileId: z.string().nullable(),
  versionNumber: z.number().nullable(),
  content: z.string().nullable(),
  contentType: z.string().nullable(),
  description: z.string().nullable(),
  versionLabel: z.string().nullable(),
})

export const awsAppConfigGetHostedConfigurationVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/get-hosted-configuration-version',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
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

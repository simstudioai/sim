import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetConfigurationProfileSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
})

const GetConfigurationProfileResponseSchema = z.object({
  applicationId: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  locationUri: z.string().nullable(),
  retrievalRoleArn: z.string().nullable(),
  type: z.string().nullable(),
  validators: z.array(z.object({ type: z.string() })),
})

export const awsAppConfigGetConfigurationProfileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/get-configuration-profile',
  body: GetConfigurationProfileSchema,
  response: { mode: 'json', schema: GetConfigurationProfileResponseSchema },
})
export type AwsAppConfigGetConfigurationProfileRequest = ContractBodyInput<
  typeof awsAppConfigGetConfigurationProfileContract
>
export type AwsAppConfigGetConfigurationProfileBody = ContractBody<
  typeof awsAppConfigGetConfigurationProfileContract
>
export type AwsAppConfigGetConfigurationProfileResponse = ContractJsonResponse<
  typeof awsAppConfigGetConfigurationProfileContract
>

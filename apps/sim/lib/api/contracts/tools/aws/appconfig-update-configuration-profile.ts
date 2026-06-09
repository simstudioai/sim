import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UpdateConfigurationProfileSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
  name: z.string().min(1).max(128).nullish(),
  description: z.string().max(1024).nullish(),
  retrievalRoleArn: z.string().nullish(),
})

const UpdateConfigurationProfileResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string().nullable(),
})

export const awsAppConfigUpdateConfigurationProfileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/update-configuration-profile',
  body: UpdateConfigurationProfileSchema,
  response: { mode: 'json', schema: UpdateConfigurationProfileResponseSchema },
})
export type AwsAppConfigUpdateConfigurationProfileRequest = ContractBodyInput<
  typeof awsAppConfigUpdateConfigurationProfileContract
>
export type AwsAppConfigUpdateConfigurationProfileBody = ContractBody<
  typeof awsAppConfigUpdateConfigurationProfileContract
>
export type AwsAppConfigUpdateConfigurationProfileResponse = ContractJsonResponse<
  typeof awsAppConfigUpdateConfigurationProfileContract
>

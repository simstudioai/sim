import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteConfigurationProfileSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
})

const DeleteConfigurationProfileResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string(),
  id: z.string(),
})

export const awsAppConfigDeleteConfigurationProfileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/delete-configuration-profile',
  body: DeleteConfigurationProfileSchema,
  response: { mode: 'json', schema: DeleteConfigurationProfileResponseSchema },
})
export type AwsAppConfigDeleteConfigurationProfileRequest = ContractBodyInput<
  typeof awsAppConfigDeleteConfigurationProfileContract
>
export type AwsAppConfigDeleteConfigurationProfileBody = ContractBody<
  typeof awsAppConfigDeleteConfigurationProfileContract
>
export type AwsAppConfigDeleteConfigurationProfileResponse = ContractJsonResponse<
  typeof awsAppConfigDeleteConfigurationProfileContract
>

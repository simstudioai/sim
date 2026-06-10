import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateConfigurationProfileSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  name: z.string().min(1, 'Configuration profile name is required').max(128),
  locationUri: z.string().min(1, 'Location URI is required').max(2048),
  description: z.string().max(1024).nullish(),
  retrievalRoleArn: z.string().nullish(),
  type: z.string().nullish(),
})

const CreateConfigurationProfileResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string(),
  id: z.string(),
  name: z.string(),
  locationUri: z.string().nullable(),
  type: z.string().nullable(),
})

export const awsAppConfigCreateConfigurationProfileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/create-configuration-profile',
  body: CreateConfigurationProfileSchema,
  response: { mode: 'json', schema: CreateConfigurationProfileResponseSchema },
})
export type AwsAppConfigCreateConfigurationProfileRequest = ContractBodyInput<
  typeof awsAppConfigCreateConfigurationProfileContract
>
export type AwsAppConfigCreateConfigurationProfileBody = ContractBody<
  typeof awsAppConfigCreateConfigurationProfileContract
>
export type AwsAppConfigCreateConfigurationProfileResponse = ContractJsonResponse<
  typeof awsAppConfigCreateConfigurationProfileContract
>

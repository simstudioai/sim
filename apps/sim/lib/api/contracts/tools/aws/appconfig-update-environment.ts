import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UpdateEnvironmentSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  environmentId: z.string().min(1, 'Environment ID is required'),
  name: z.string().min(1).max(64).nullish(),
  description: z.string().max(1024).nullish(),
})

const UpdateEnvironmentResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string(),
  id: z.string(),
  name: z.string(),
  state: z.string().nullable(),
})

export const awsAppConfigUpdateEnvironmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/update-environment',
  body: UpdateEnvironmentSchema,
  response: { mode: 'json', schema: UpdateEnvironmentResponseSchema },
})
export type AwsAppConfigUpdateEnvironmentRequest = ContractBodyInput<
  typeof awsAppConfigUpdateEnvironmentContract
>
export type AwsAppConfigUpdateEnvironmentBody = ContractBody<
  typeof awsAppConfigUpdateEnvironmentContract
>
export type AwsAppConfigUpdateEnvironmentResponse = ContractJsonResponse<
  typeof awsAppConfigUpdateEnvironmentContract
>

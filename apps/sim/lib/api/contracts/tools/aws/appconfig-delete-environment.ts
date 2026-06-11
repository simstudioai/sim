import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteEnvironmentSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  environmentId: z.string().min(1, 'Environment ID is required'),
})

const DeleteEnvironmentResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string(),
  id: z.string(),
})

export const awsAppConfigDeleteEnvironmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/delete-environment',
  body: DeleteEnvironmentSchema,
  response: { mode: 'json', schema: DeleteEnvironmentResponseSchema },
})
export type AwsAppConfigDeleteEnvironmentRequest = ContractBodyInput<
  typeof awsAppConfigDeleteEnvironmentContract
>
export type AwsAppConfigDeleteEnvironmentBody = ContractBody<
  typeof awsAppConfigDeleteEnvironmentContract
>
export type AwsAppConfigDeleteEnvironmentResponse = ContractJsonResponse<
  typeof awsAppConfigDeleteEnvironmentContract
>

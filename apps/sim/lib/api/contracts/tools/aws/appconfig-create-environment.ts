import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateEnvironmentSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  name: z.string().min(1, 'Environment name is required').max(64),
  description: z.string().max(1024).nullish(),
})

const CreateEnvironmentResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string(),
  id: z.string(),
  name: z.string(),
  state: z.string().nullable(),
})

export const awsAppConfigCreateEnvironmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/create-environment',
  body: CreateEnvironmentSchema,
  response: { mode: 'json', schema: CreateEnvironmentResponseSchema },
})
export type AwsAppConfigCreateEnvironmentRequest = ContractBodyInput<
  typeof awsAppConfigCreateEnvironmentContract
>
export type AwsAppConfigCreateEnvironmentBody = ContractBody<
  typeof awsAppConfigCreateEnvironmentContract
>
export type AwsAppConfigCreateEnvironmentResponse = ContractJsonResponse<
  typeof awsAppConfigCreateEnvironmentContract
>

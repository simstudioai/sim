import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const StartDeploymentSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  environmentId: z.string().min(1, 'Environment ID is required'),
  deploymentStrategyId: z.string().min(1, 'Deployment strategy ID is required'),
  configurationProfileId: z.string().min(1, 'Configuration profile ID is required'),
  configurationVersion: z.string().min(1, 'Configuration version is required'),
  description: z.string().max(1024).nullish(),
})

const StartDeploymentResponseSchema = z.object({
  message: z.string(),
  deploymentNumber: z.number().nullable(),
  state: z.string().nullable(),
  percentageComplete: z.number().nullable(),
})

export const awsAppConfigStartDeploymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/start-deployment',
  body: StartDeploymentSchema,
  response: { mode: 'json', schema: StartDeploymentResponseSchema },
})
export type AwsAppConfigStartDeploymentRequest = ContractBodyInput<
  typeof awsAppConfigStartDeploymentContract
>
export type AwsAppConfigStartDeploymentBody = ContractBody<
  typeof awsAppConfigStartDeploymentContract
>
export type AwsAppConfigStartDeploymentResponse = ContractJsonResponse<
  typeof awsAppConfigStartDeploymentContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetDeploymentSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  environmentId: z.string().min(1, 'Environment ID is required'),
  deploymentNumber: z.number().int().min(1, 'Deployment number is required'),
})

const GetDeploymentResponseSchema = z.object({
  applicationId: z.string(),
  environmentId: z.string(),
  deploymentStrategyId: z.string(),
  configurationProfileId: z.string(),
  deploymentNumber: z.number().nullable(),
  configurationName: z.string().nullable(),
  configurationVersion: z.string().nullable(),
  description: z.string().nullable(),
  state: z.string().nullable(),
  percentageComplete: z.number().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
})

export const awsAppConfigGetDeploymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/get-deployment',
  body: GetDeploymentSchema,
  response: { mode: 'json', schema: GetDeploymentResponseSchema },
})
export type AwsAppConfigGetDeploymentRequest = ContractBodyInput<
  typeof awsAppConfigGetDeploymentContract
>
export type AwsAppConfigGetDeploymentBody = ContractBody<typeof awsAppConfigGetDeploymentContract>
export type AwsAppConfigGetDeploymentResponse = ContractJsonResponse<
  typeof awsAppConfigGetDeploymentContract
>

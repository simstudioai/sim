import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const StopDeploymentSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  environmentId: z.string().min(1, 'Environment ID is required'),
  deploymentNumber: z.number().int().min(1, 'Deployment number is required'),
})

const StopDeploymentResponseSchema = z.object({
  message: z.string(),
  deploymentNumber: z.number().nullable(),
  state: z.string().nullable(),
})

export const awsAppConfigStopDeploymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/stop-deployment',
  body: StopDeploymentSchema,
  response: { mode: 'json', schema: StopDeploymentResponseSchema },
})
export type AwsAppConfigStopDeploymentRequest = ContractBodyInput<
  typeof awsAppConfigStopDeploymentContract
>
export type AwsAppConfigStopDeploymentBody = ContractBody<typeof awsAppConfigStopDeploymentContract>
export type AwsAppConfigStopDeploymentResponse = ContractJsonResponse<
  typeof awsAppConfigStopDeploymentContract
>

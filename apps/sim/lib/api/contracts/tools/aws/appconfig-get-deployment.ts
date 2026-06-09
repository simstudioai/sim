import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const Schema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  environmentId: z.string().min(1, 'Environment ID is required'),
  deploymentNumber: z.number().int().min(1, 'Deployment number is required'),
})

const ResponseSchema = z.object({
  message: z.string(),
  applicationId: z.string().nullable(),
  environmentId: z.string().nullable(),
  deploymentNumber: z.number().nullable(),
  deploymentStrategyId: z.string().nullable(),
  configurationProfileId: z.string().nullable(),
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
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsAppConfigGetDeploymentRequest = ContractBodyInput<
  typeof awsAppConfigGetDeploymentContract
>
export type AwsAppConfigGetDeploymentBody = ContractBody<typeof awsAppConfigGetDeploymentContract>
export type AwsAppConfigGetDeploymentResponse = ContractJsonResponse<
  typeof awsAppConfigGetDeploymentContract
>

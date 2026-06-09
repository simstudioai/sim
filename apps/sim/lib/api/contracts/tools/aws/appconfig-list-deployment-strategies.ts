import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListDeploymentStrategiesSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const DeploymentStrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  deploymentDurationInMinutes: z.number().nullable(),
  growthType: z.string().nullable(),
  growthFactor: z.number().nullable(),
  finalBakeTimeInMinutes: z.number().nullable(),
  replicateTo: z.string().nullable(),
})

const ListDeploymentStrategiesResponseSchema = z.object({
  deploymentStrategies: z.array(DeploymentStrategySchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsAppConfigListDeploymentStrategiesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/list-deployment-strategies',
  body: ListDeploymentStrategiesSchema,
  response: { mode: 'json', schema: ListDeploymentStrategiesResponseSchema },
})
export type AwsAppConfigListDeploymentStrategiesRequest = ContractBodyInput<
  typeof awsAppConfigListDeploymentStrategiesContract
>
export type AwsAppConfigListDeploymentStrategiesBody = ContractBody<
  typeof awsAppConfigListDeploymentStrategiesContract
>
export type AwsAppConfigListDeploymentStrategiesResponse = ContractJsonResponse<
  typeof awsAppConfigListDeploymentStrategiesContract
>

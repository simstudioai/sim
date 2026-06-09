import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListDeploymentsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  environmentId: z.string().min(1, 'Environment ID is required'),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const DeploymentSummarySchema = z.object({
  deploymentNumber: z.number().nullable(),
  configurationName: z.string().nullable(),
  configurationVersion: z.string().nullable(),
  deploymentDurationInMinutes: z.number().nullable(),
  growthType: z.string().nullable(),
  growthFactor: z.number().nullable(),
  finalBakeTimeInMinutes: z.number().nullable(),
  state: z.string().nullable(),
  percentageComplete: z.number().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  versionLabel: z.string().nullable(),
})

const ListDeploymentsResponseSchema = z.object({
  deployments: z.array(DeploymentSummarySchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsAppConfigListDeploymentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/list-deployments',
  body: ListDeploymentsSchema,
  response: { mode: 'json', schema: ListDeploymentsResponseSchema },
})
export type AwsAppConfigListDeploymentsRequest = ContractBodyInput<
  typeof awsAppConfigListDeploymentsContract
>
export type AwsAppConfigListDeploymentsBody = ContractBody<
  typeof awsAppConfigListDeploymentsContract
>
export type AwsAppConfigListDeploymentsResponse = ContractJsonResponse<
  typeof awsAppConfigListDeploymentsContract
>

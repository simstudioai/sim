import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetEnvironmentSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  environmentId: z.string().min(1, 'Environment ID is required'),
})

const GetEnvironmentResponseSchema = z.object({
  applicationId: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  state: z.string().nullable(),
  monitors: z.array(
    z.object({
      alarmArn: z.string(),
      alarmRoleArn: z.string().nullable(),
    })
  ),
})

export const awsAppConfigGetEnvironmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/get-environment',
  body: GetEnvironmentSchema,
  response: { mode: 'json', schema: GetEnvironmentResponseSchema },
})
export type AwsAppConfigGetEnvironmentRequest = ContractBodyInput<
  typeof awsAppConfigGetEnvironmentContract
>
export type AwsAppConfigGetEnvironmentBody = ContractBody<typeof awsAppConfigGetEnvironmentContract>
export type AwsAppConfigGetEnvironmentResponse = ContractJsonResponse<
  typeof awsAppConfigGetEnvironmentContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetApplicationSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
})

const GetApplicationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
})

export const awsAppConfigGetApplicationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/get-application',
  body: GetApplicationSchema,
  response: { mode: 'json', schema: GetApplicationResponseSchema },
})
export type AwsAppConfigGetApplicationRequest = ContractBodyInput<
  typeof awsAppConfigGetApplicationContract
>
export type AwsAppConfigGetApplicationBody = ContractBody<typeof awsAppConfigGetApplicationContract>
export type AwsAppConfigGetApplicationResponse = ContractJsonResponse<
  typeof awsAppConfigGetApplicationContract
>

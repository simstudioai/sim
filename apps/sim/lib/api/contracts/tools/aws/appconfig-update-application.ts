import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UpdateApplicationSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
  name: z.string().min(1).max(64).nullish(),
  description: z.string().max(1024).nullish(),
})

const UpdateApplicationResponseSchema = z.object({
  message: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
})

export const awsAppConfigUpdateApplicationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/update-application',
  body: UpdateApplicationSchema,
  response: { mode: 'json', schema: UpdateApplicationResponseSchema },
})
export type AwsAppConfigUpdateApplicationRequest = ContractBodyInput<
  typeof awsAppConfigUpdateApplicationContract
>
export type AwsAppConfigUpdateApplicationBody = ContractBody<
  typeof awsAppConfigUpdateApplicationContract
>
export type AwsAppConfigUpdateApplicationResponse = ContractJsonResponse<
  typeof awsAppConfigUpdateApplicationContract
>

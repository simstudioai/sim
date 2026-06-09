import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteApplicationSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  applicationId: z.string().min(1, 'Application ID is required'),
})

const DeleteApplicationResponseSchema = z.object({
  message: z.string(),
  id: z.string(),
})

export const awsAppConfigDeleteApplicationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/delete-application',
  body: DeleteApplicationSchema,
  response: { mode: 'json', schema: DeleteApplicationResponseSchema },
})
export type AwsAppConfigDeleteApplicationRequest = ContractBodyInput<
  typeof awsAppConfigDeleteApplicationContract
>
export type AwsAppConfigDeleteApplicationBody = ContractBody<
  typeof awsAppConfigDeleteApplicationContract
>
export type AwsAppConfigDeleteApplicationResponse = ContractJsonResponse<
  typeof awsAppConfigDeleteApplicationContract
>

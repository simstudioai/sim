import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateApplicationSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  name: z.string().min(1, 'Application name is required').max(64),
  description: z.string().max(1024).nullish(),
})

const CreateApplicationResponseSchema = z.object({
  message: z.string(),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
})

export const awsAppConfigCreateApplicationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/create-application',
  body: CreateApplicationSchema,
  response: { mode: 'json', schema: CreateApplicationResponseSchema },
})
export type AwsAppConfigCreateApplicationRequest = ContractBodyInput<
  typeof awsAppConfigCreateApplicationContract
>
export type AwsAppConfigCreateApplicationBody = ContractBody<
  typeof awsAppConfigCreateApplicationContract
>
export type AwsAppConfigCreateApplicationResponse = ContractJsonResponse<
  typeof awsAppConfigCreateApplicationContract
>

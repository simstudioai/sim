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
  maxResults: z.number().int().min(1).max(50).optional().nullable(),
  nextToken: z.string().optional().nullable(),
})

const ResponseSchema = z.object({
  items: z.array(
    z.object({
      applicationId: z.string().nullable(),
      id: z.string().nullable(),
      name: z.string().nullable(),
      state: z.string().nullable(),
      description: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
})

export const awsAppConfigListEnvironmentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/appconfig/list-environments',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsAppConfigListEnvironmentsRequest = ContractBodyInput<
  typeof awsAppConfigListEnvironmentsContract
>
export type AwsAppConfigListEnvironmentsBody = ContractBody<
  typeof awsAppConfigListEnvironmentsContract
>
export type AwsAppConfigListEnvironmentsResponse = ContractJsonResponse<
  typeof awsAppConfigListEnvironmentsContract
>

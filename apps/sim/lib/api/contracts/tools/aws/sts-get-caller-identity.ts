import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetCallerIdentitySchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
})

const GetCallerIdentityResponseSchema = z.object({
  account: z.string(),
  arn: z.string(),
  userId: z.string(),
})

export const awsStsGetCallerIdentityContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sts/get-caller-identity',
  body: GetCallerIdentitySchema,
  response: { mode: 'json', schema: GetCallerIdentityResponseSchema },
})
export type AwsStsGetCallerIdentityRequest = ContractBodyInput<
  typeof awsStsGetCallerIdentityContract
>
export type AwsStsGetCallerIdentityBody = ContractBody<typeof awsStsGetCallerIdentityContract>
export type AwsStsGetCallerIdentityResponse = ContractJsonResponse<
  typeof awsStsGetCallerIdentityContract
>

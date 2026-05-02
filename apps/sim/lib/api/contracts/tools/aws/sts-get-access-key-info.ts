import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetAccessKeyInfoSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  targetAccessKeyId: z.string().min(1, 'Target access key ID is required'),
})

const GetAccessKeyInfoResponseSchema = z.object({
  account: z.string(),
})

export const awsStsGetAccessKeyInfoContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sts/get-access-key-info',
  body: GetAccessKeyInfoSchema,
  response: { mode: 'json', schema: GetAccessKeyInfoResponseSchema },
})
export type AwsStsGetAccessKeyInfoRequest = ContractBodyInput<typeof awsStsGetAccessKeyInfoContract>
export type AwsStsGetAccessKeyInfoBody = ContractBody<typeof awsStsGetAccessKeyInfoContract>
export type AwsStsGetAccessKeyInfoResponse = ContractJsonResponse<
  typeof awsStsGetAccessKeyInfoContract
>

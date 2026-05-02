import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetAccountSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
})

const GetAccountResponseSchema = z.object({
  sendingEnabled: z.boolean(),
  max24HourSend: z.number(),
  maxSendRate: z.number(),
  sentLast24Hours: z.number(),
})

export const awsSesGetAccountContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/get-account',
  body: GetAccountSchema,
  response: { mode: 'json', schema: GetAccountResponseSchema },
})
export type AwsSesGetAccountRequest = ContractBodyInput<typeof awsSesGetAccountContract>
export type AwsSesGetAccountBody = ContractBody<typeof awsSesGetAccountContract>
export type AwsSesGetAccountResponse = ContractJsonResponse<typeof awsSesGetAccountContract>

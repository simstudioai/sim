import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetSessionTokenSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  durationSeconds: z.number().int().min(900).max(129600).nullish(),
  serialNumber: z.string().nullish(),
  tokenCode: z.string().nullish(),
})

const GetSessionTokenResponseSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string(),
  expiration: z.string().nullable(),
})

export const awsStsGetSessionTokenContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sts/get-session-token',
  body: GetSessionTokenSchema,
  response: { mode: 'json', schema: GetSessionTokenResponseSchema },
})
export type AwsStsGetSessionTokenRequest = ContractBodyInput<typeof awsStsGetSessionTokenContract>
export type AwsStsGetSessionTokenBody = ContractBody<typeof awsStsGetSessionTokenContract>
export type AwsStsGetSessionTokenResponse = ContractJsonResponse<
  typeof awsStsGetSessionTokenContract
>

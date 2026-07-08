import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetSuppressedDestinationSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  emailAddress: z.string().email('A valid email address is required'),
})

const GetSuppressedDestinationResponseSchema = z.object({
  emailAddress: z.string(),
  reason: z.string(),
  lastUpdateTime: z.string().nullable(),
  messageId: z.string().nullable(),
  feedbackId: z.string().nullable(),
})

export const awsSesGetSuppressedDestinationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/get-suppressed-destination',
  body: GetSuppressedDestinationSchema,
  response: { mode: 'json', schema: GetSuppressedDestinationResponseSchema },
})
export type AwsSesGetSuppressedDestinationRequest = ContractBodyInput<
  typeof awsSesGetSuppressedDestinationContract
>
export type AwsSesGetSuppressedDestinationBody = ContractBody<
  typeof awsSesGetSuppressedDestinationContract
>
export type AwsSesGetSuppressedDestinationResponse = ContractJsonResponse<
  typeof awsSesGetSuppressedDestinationContract
>

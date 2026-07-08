import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const PutSuppressedDestinationSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  emailAddress: z.string().email('A valid email address is required'),
  reason: z.enum(['BOUNCE', 'COMPLAINT'], {
    message: 'Reason must be BOUNCE or COMPLAINT',
  }),
})

const PutSuppressedDestinationResponseSchema = z.object({
  message: z.string(),
})

export const awsSesPutSuppressedDestinationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/put-suppressed-destination',
  body: PutSuppressedDestinationSchema,
  response: { mode: 'json', schema: PutSuppressedDestinationResponseSchema },
})
export type AwsSesPutSuppressedDestinationRequest = ContractBodyInput<
  typeof awsSesPutSuppressedDestinationContract
>
export type AwsSesPutSuppressedDestinationBody = ContractBody<
  typeof awsSesPutSuppressedDestinationContract
>
export type AwsSesPutSuppressedDestinationResponse = ContractJsonResponse<
  typeof awsSesPutSuppressedDestinationContract
>

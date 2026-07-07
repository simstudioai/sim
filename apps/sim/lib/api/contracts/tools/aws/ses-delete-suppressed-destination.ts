import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DeleteSuppressedDestinationSchema = z.object({
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

const DeleteSuppressedDestinationResponseSchema = z.object({
  message: z.string(),
})

export const awsSesDeleteSuppressedDestinationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/delete-suppressed-destination',
  body: DeleteSuppressedDestinationSchema,
  response: { mode: 'json', schema: DeleteSuppressedDestinationResponseSchema },
})
export type AwsSesDeleteSuppressedDestinationRequest = ContractBodyInput<
  typeof awsSesDeleteSuppressedDestinationContract
>
export type AwsSesDeleteSuppressedDestinationBody = ContractBody<
  typeof awsSesDeleteSuppressedDestinationContract
>
export type AwsSesDeleteSuppressedDestinationResponse = ContractJsonResponse<
  typeof awsSesDeleteSuppressedDestinationContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DeleteEmailIdentitySchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  emailIdentity: z.string().min(1, 'Email identity (domain or address) is required'),
})

const DeleteEmailIdentityResponseSchema = z.object({
  message: z.string(),
})

export const awsSesDeleteEmailIdentityContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/delete-email-identity',
  body: DeleteEmailIdentitySchema,
  response: { mode: 'json', schema: DeleteEmailIdentityResponseSchema },
})
export type AwsSesDeleteEmailIdentityRequest = ContractBodyInput<
  typeof awsSesDeleteEmailIdentityContract
>
export type AwsSesDeleteEmailIdentityBody = ContractBody<typeof awsSesDeleteEmailIdentityContract>
export type AwsSesDeleteEmailIdentityResponse = ContractJsonResponse<
  typeof awsSesDeleteEmailIdentityContract
>

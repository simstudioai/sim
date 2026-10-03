import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const RequestSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  name: z.string().min(1, 'Parameter name is required').max(2048),
})

const ResponseSchema = z.object({
  message: z.string(),
  name: z.string(),
})

export const awsSsmDeleteParameterContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/delete-parameter',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmDeleteParameterRequest = ContractBodyInput<typeof awsSsmDeleteParameterContract>
export type AwsSsmDeleteParameterBody = ContractBody<typeof awsSsmDeleteParameterContract>
export type AwsSsmDeleteParameterResponse = ContractJsonResponse<
  typeof awsSsmDeleteParameterContract
>

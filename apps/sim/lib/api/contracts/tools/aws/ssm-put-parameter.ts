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
  value: z.string().min(1, 'Parameter value is required'),
  type: z.enum(['String', 'StringList', 'SecureString']).nullish(),
  description: z.string().max(1024).nullish(),
  keyId: z.string().min(1).max(256).nullish(),
  overwrite: z.boolean().nullish(),
  allowedPattern: z.string().max(1024).nullish(),
  tier: z.enum(['Standard', 'Advanced', 'Intelligent-Tiering']).nullish(),
  dataType: z.string().max(128).nullish(),
  policies: z.string().min(1).max(4096).nullish(),
})

const ResponseSchema = z.object({
  message: z.string(),
  name: z.string(),
  version: z.number().nullable(),
  tier: z.string().nullable(),
})

export const awsSsmPutParameterContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/put-parameter',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmPutParameterRequest = ContractBodyInput<typeof awsSsmPutParameterContract>
export type AwsSsmPutParameterBody = ContractBody<typeof awsSsmPutParameterContract>
export type AwsSsmPutParameterResponse = ContractJsonResponse<typeof awsSsmPutParameterContract>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ParameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.string(),
  version: z.number().nullable(),
  selector: z.string().nullable(),
  sourceResult: z.string().nullable(),
  lastModifiedDate: z.string().nullable(),
  arn: z.string(),
  dataType: z.string().nullable(),
})

const RequestSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  names: z
    .array(z.string().min(1).max(2048))
    .min(1, 'At least one parameter name is required')
    .max(10, 'GetParameters accepts at most 10 names'),
  withDecryption: z.boolean().nullish(),
})

const ResponseSchema = z.object({
  parameters: z.array(ParameterSchema),
  invalidParameters: z.array(z.string()),
  count: z.number(),
})

export const awsSsmGetParametersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/get-parameters',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmGetParametersRequest = ContractBodyInput<typeof awsSsmGetParametersContract>
export type AwsSsmGetParametersBody = ContractBody<typeof awsSsmGetParametersContract>
export type AwsSsmGetParametersResponse = ContractJsonResponse<typeof awsSsmGetParametersContract>

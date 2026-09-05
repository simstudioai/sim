import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ParameterStringFilterSchema = z.object({
  Key: z.string().min(1, 'Filter Key is required'),
  Option: z.string().min(1).max(10).optional(),
  Values: z.array(z.string().min(1)).min(1).max(50).optional(),
})

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
  path: z.string().min(1, 'Parameter path is required').max(2048),
  recursive: z.boolean().nullish(),
  withDecryption: z.boolean().nullish(),
  parameterFilters: z.array(ParameterStringFilterSchema).nullish(),
  maxResults: z.number().int().min(1).max(10).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  parameters: z.array(ParameterSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmGetParametersByPathContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/get-parameters-by-path',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmGetParametersByPathRequest = ContractBodyInput<
  typeof awsSsmGetParametersByPathContract
>
export type AwsSsmGetParametersByPathBody = ContractBody<typeof awsSsmGetParametersByPathContract>
export type AwsSsmGetParametersByPathResponse = ContractJsonResponse<
  typeof awsSsmGetParametersByPathContract
>

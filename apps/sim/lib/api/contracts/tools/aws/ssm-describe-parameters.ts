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

const ParameterMetadataSchema = z.object({
  name: z.string(),
  arn: z.string(),
  type: z.string(),
  keyId: z.string().nullable(),
  lastModifiedDate: z.string().nullable(),
  lastModifiedUser: z.string().nullable(),
  description: z.string().nullable(),
  allowedPattern: z.string().nullable(),
  version: z.number().nullable(),
  tier: z.string().nullable(),
  dataType: z.string().nullable(),
  policies: z.array(
    z.object({
      policyText: z.string().nullable(),
      policyType: z.string().nullable(),
      policyStatus: z.string().nullable(),
    })
  ),
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
  parameterFilters: z.array(ParameterStringFilterSchema).nullish(),
  shared: z.boolean().nullish(),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  parameters: z.array(ParameterMetadataSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmDescribeParametersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/describe-parameters',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmDescribeParametersRequest = ContractBodyInput<
  typeof awsSsmDescribeParametersContract
>
export type AwsSsmDescribeParametersBody = ContractBody<typeof awsSsmDescribeParametersContract>
export type AwsSsmDescribeParametersResponse = ContractJsonResponse<
  typeof awsSsmDescribeParametersContract
>

import { z } from 'zod'
import {
  lambdaAliasSchema,
  lambdaConnectionFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UpdateAliasSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  aliasName: z
    .string()
    .min(1, 'aliasName is required')
    .max(128, 'aliasName cannot exceed 128 characters')
    .regex(
      /^(?![0-9]+$)[a-zA-Z0-9-_]+$/,
      'aliasName may only contain letters, numbers, hyphens, and underscores, and cannot be all digits'
    ),
  aliasFunctionVersion: z.string().min(1, 'aliasFunctionVersion cannot be empty').optional(),
  description: z.string().max(256, 'description cannot exceed 256 characters').optional(),
  additionalVersionWeights: z
    .record(
      z.string().regex(/^[0-9]+$/, 'routing keys must be published version numbers'),
      z
        .number()
        .min(0, 'a routing weight cannot be negative')
        .max(1, 'a routing weight cannot exceed 1')
    )
    .refine(
      (weights) => Object.keys(weights).length <= 1,
      'additionalVersionWeights routes to a single second version, so it accepts at most one entry'
    )
    .optional(),
  revisionId: z.string().min(1, 'revisionId cannot be empty').optional(),
})

const UpdateAliasResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    alias: lambdaAliasSchema,
  }),
})

export const awsLambdaUpdateAliasContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/update-alias',
  body: UpdateAliasSchema,
  response: { mode: 'json', schema: UpdateAliasResponseSchema },
})
export type AwsLambdaUpdateAliasRequest = ContractBodyInput<typeof awsLambdaUpdateAliasContract>
export type AwsLambdaUpdateAliasBody = ContractBody<typeof awsLambdaUpdateAliasContract>
export type AwsLambdaUpdateAliasResponse = ContractJsonResponse<typeof awsLambdaUpdateAliasContract>

import { z } from 'zod'
import {
  lambdaAliasSchema,
  lambdaConnectionFields,
  lambdaPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListAliasesSchema = z.object({
  ...lambdaConnectionFields,
  ...lambdaPaginationFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  aliasFunctionVersion: z.string().min(1, 'aliasFunctionVersion cannot be empty').optional(),
})

const ListAliasesResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    aliases: z.array(lambdaAliasSchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListAliasesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-aliases',
  body: ListAliasesSchema,
  response: { mode: 'json', schema: ListAliasesResponseSchema },
})
export type AwsLambdaListAliasesRequest = ContractBodyInput<typeof awsLambdaListAliasesContract>
export type AwsLambdaListAliasesBody = ContractBody<typeof awsLambdaListAliasesContract>
export type AwsLambdaListAliasesResponse = ContractJsonResponse<typeof awsLambdaListAliasesContract>

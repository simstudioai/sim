import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaFunctionConfigurationSchema,
  lambdaPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListFunctionsSchema = z
  .object({
    ...lambdaConnectionFields,
    ...lambdaPaginationFields,
    functionVersion: z.literal('ALL').optional(),
    masterRegion: z.string().min(1, 'masterRegion cannot be empty').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.masterRegion && value.functionVersion !== 'ALL') {
      ctx.addIssue({
        code: 'custom',
        path: ['functionVersion'],
        message: 'functionVersion must be ALL when masterRegion is set',
      })
    }
  })

const ListFunctionsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    functions: z.array(lambdaFunctionConfigurationSchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListFunctionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-functions',
  body: ListFunctionsSchema,
  response: { mode: 'json', schema: ListFunctionsResponseSchema },
})
export type AwsLambdaListFunctionsRequest = ContractBodyInput<typeof awsLambdaListFunctionsContract>
export type AwsLambdaListFunctionsBody = ContractBody<typeof awsLambdaListFunctionsContract>
export type AwsLambdaListFunctionsResponse = ContractJsonResponse<
  typeof awsLambdaListFunctionsContract
>

import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetAccountSettingsSchema = z.object({
  ...lambdaConnectionFields,
})

const GetAccountSettingsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    accountLimit: z
      .object({
        totalCodeSize: z.number().nullable(),
        codeSizeUnzipped: z.number().nullable(),
        codeSizeZipped: z.number().nullable(),
        concurrentExecutions: z.number().nullable(),
        unreservedConcurrentExecutions: z.number().nullable(),
      })
      .nullable(),
    accountUsage: z
      .object({
        totalCodeSize: z.number().nullable(),
        functionCount: z.number().nullable(),
      })
      .nullable(),
  }),
})

export const awsLambdaGetAccountSettingsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-account-settings',
  body: GetAccountSettingsSchema,
  response: { mode: 'json', schema: GetAccountSettingsResponseSchema },
})
export type AwsLambdaGetAccountSettingsRequest = ContractBodyInput<
  typeof awsLambdaGetAccountSettingsContract
>
export type AwsLambdaGetAccountSettingsBody = ContractBody<
  typeof awsLambdaGetAccountSettingsContract
>
export type AwsLambdaGetAccountSettingsResponse = ContractJsonResponse<
  typeof awsLambdaGetAccountSettingsContract
>

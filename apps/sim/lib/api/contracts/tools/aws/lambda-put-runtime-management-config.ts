import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const PutRuntimeManagementConfigSchema = z
  .object({
    ...lambdaConnectionFields,
    functionName: z
      .string()
      .min(1, 'functionName is required')
      .max(256, 'functionName cannot exceed 256 characters'),
    updateRuntimeOn: z.enum(['Auto', 'FunctionUpdate', 'Manual']),
    runtimeVersionArn: z.string().optional(),
    qualifier: z
      .string()
      .min(1, 'qualifier cannot be empty')
      .max(128, 'qualifier cannot exceed 128 characters')
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.updateRuntimeOn === 'Manual' && !value.runtimeVersionArn) {
      ctx.addIssue({
        code: 'custom',
        path: ['runtimeVersionArn'],
        message: 'runtimeVersionArn is required when updateRuntimeOn is Manual',
      })
    }
  })

const PutRuntimeManagementConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    updateRuntimeOn: z.string().nullable(),
    runtimeVersionArn: z.string().nullable(),
    functionArn: z.string().nullable(),
  }),
})

export const awsLambdaPutRuntimeManagementConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/put-runtime-management-config',
  body: PutRuntimeManagementConfigSchema,
  response: { mode: 'json', schema: PutRuntimeManagementConfigResponseSchema },
})
export type AwsLambdaPutRuntimeManagementConfigRequest = ContractBodyInput<
  typeof awsLambdaPutRuntimeManagementConfigContract
>
export type AwsLambdaPutRuntimeManagementConfigBody = ContractBody<
  typeof awsLambdaPutRuntimeManagementConfigContract
>
export type AwsLambdaPutRuntimeManagementConfigResponse = ContractJsonResponse<
  typeof awsLambdaPutRuntimeManagementConfigContract
>

import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaFunctionConfigurationSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UpdateFunctionCodeSchema = z
  .object({
    ...lambdaConnectionFields,
    functionName: z
      .string()
      .min(1, 'functionName is required')
      .max(256, 'functionName cannot exceed 256 characters'),
    s3Bucket: z.string().optional(),
    s3Key: z.string().optional(),
    s3ObjectVersion: z.string().optional(),
    imageUri: z.string().optional(),
    sourceKmsKeyArn: z.string().optional(),
    architectures: z
      .array(z.enum(['x86_64', 'arm64']))
      .length(1, 'architectures takes exactly one value')
      .optional(),
    publish: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    revisionId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const hasAnyZipField = Boolean(
      value.s3Bucket || value.s3Key || value.s3ObjectVersion || value.sourceKmsKeyArn
    )
    const hasS3 = Boolean(value.s3Bucket && value.s3Key)
    if (value.imageUri && hasAnyZipField) {
      ctx.addIssue({
        code: 'custom',
        path: ['imageUri'],
        message:
          'Provide either a .zip package (s3Bucket, s3Key, s3ObjectVersion, sourceKmsKeyArn) or imageUri, not both',
      })
      return
    }
    if (!value.imageUri && !hasS3) {
      ctx.addIssue({
        code: 'custom',
        path: hasAnyZipField ? ['s3Key'] : ['s3Bucket'],
        message: hasAnyZipField
          ? 's3Bucket and s3Key must be provided together for a .zip package'
          : 'A code source is required: provide s3Bucket and s3Key for a .zip package, or imageUri for a container image',
      })
    }
  })

const UpdateFunctionCodeResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    configuration: lambdaFunctionConfigurationSchema,
  }),
})

export const awsLambdaUpdateFunctionCodeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/update-function-code',
  body: UpdateFunctionCodeSchema,
  response: { mode: 'json', schema: UpdateFunctionCodeResponseSchema },
})
export type AwsLambdaUpdateFunctionCodeRequest = ContractBodyInput<
  typeof awsLambdaUpdateFunctionCodeContract
>
export type AwsLambdaUpdateFunctionCodeBody = ContractBody<
  typeof awsLambdaUpdateFunctionCodeContract
>
export type AwsLambdaUpdateFunctionCodeResponse = ContractJsonResponse<
  typeof awsLambdaUpdateFunctionCodeContract
>

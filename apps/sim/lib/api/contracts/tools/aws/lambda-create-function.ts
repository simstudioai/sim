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

const CreateFunctionSchema = z
  .object({
    ...lambdaConnectionFields,
    functionName: z.string().min(1, 'functionName is required'),
    role: z.string().min(1, 'role is required'),
    runtime: z.string().optional(),
    handler: z.string().optional(),
    packageType: z.enum(['Zip', 'Image']).optional(),
    s3Bucket: z.string().optional(),
    s3Key: z.string().optional(),
    s3ObjectVersion: z.string().optional(),
    imageUri: z.string().optional(),
    sourceKmsKeyArn: z.string().optional(),
    description: z.string().optional(),
    timeout: z.number().int().min(1).max(900).optional(),
    memorySize: z.number().int().min(128).max(32768).optional(),
    ephemeralStorageSize: z.number().int().min(512).max(10240).optional(),
    publish: z.boolean().optional(),
    environment: z.record(z.string(), z.string()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
    architectures: z.array(z.enum(['x86_64', 'arm64'])).optional(),
    layers: z.array(z.string()).optional(),
    vpcSubnetIds: z.array(z.string()).optional(),
    vpcSecurityGroupIds: z.array(z.string()).optional(),
    tracingMode: z.enum(['Active', 'PassThrough']).optional(),
    deadLetterTargetArn: z.string().optional(),
    kmsKeyArn: z.string().optional(),
    snapStartApplyOn: z.enum(['PublishedVersions', 'None']).optional(),
    logFormat: z.enum(['JSON', 'Text']).optional(),
    logGroup: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const hasS3 = Boolean(value.s3Bucket && value.s3Key)
    if (!hasS3 && !value.imageUri) {
      ctx.addIssue({
        code: 'custom',
        path: ['s3Bucket'],
        message:
          'A code source is required: provide s3Bucket and s3Key for a .zip package, or imageUri for a container image',
      })
    }
  })

const CreateFunctionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    configuration: lambdaFunctionConfigurationSchema,
  }),
})

export const awsLambdaCreateFunctionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/create-function',
  body: CreateFunctionSchema,
  response: { mode: 'json', schema: CreateFunctionResponseSchema },
})
export type AwsLambdaCreateFunctionRequest = ContractBodyInput<
  typeof awsLambdaCreateFunctionContract
>
export type AwsLambdaCreateFunctionBody = ContractBody<typeof awsLambdaCreateFunctionContract>
export type AwsLambdaCreateFunctionResponse = ContractJsonResponse<
  typeof awsLambdaCreateFunctionContract
>

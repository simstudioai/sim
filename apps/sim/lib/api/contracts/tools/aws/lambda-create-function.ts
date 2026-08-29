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
    functionName: z
      .string()
      .min(1, 'functionName is required')
      .max(256, 'functionName cannot exceed 256 characters'),
    role: z.string().min(1, 'role is required'),
    runtime: z.string().min(1, 'runtime cannot be empty').optional(),
    handler: z.string().min(1, 'handler cannot be empty').optional(),
    packageType: z.enum(['Zip', 'Image']).optional(),
    s3Bucket: z.string().min(1, 's3Bucket cannot be empty').optional(),
    s3Key: z.string().min(1, 's3Key cannot be empty').optional(),
    s3ObjectVersion: z.string().min(1, 's3ObjectVersion cannot be empty').optional(),
    imageUri: z.string().min(1, 'imageUri cannot be empty').optional(),
    sourceKmsKeyArn: z.string().min(1, 'sourceKmsKeyArn cannot be empty').optional(),
    description: z.string().max(256, 'description cannot exceed 256 characters').optional(),
    functionTimeout: z.number().int().min(1).max(900).optional(),
    memorySize: z.number().int().min(128).max(32768).optional(),
    ephemeralStorageSize: z.number().int().min(512).max(10240).optional(),
    publish: z.boolean().optional(),
    environment: z.record(z.string(), z.string()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
    architectures: z
      .array(z.enum(['x86_64', 'arm64']))
      .length(1, 'architectures takes exactly one value')
      .optional(),
    layers: z.array(z.string()).optional(),
    vpcSubnetIds: z.array(z.string()).optional(),
    vpcSecurityGroupIds: z.array(z.string()).optional(),
    tracingMode: z.enum(['Active', 'PassThrough']).optional(),
    deadLetterTargetArn: z.string().min(1, 'deadLetterTargetArn cannot be empty').optional(),
    kmsKeyArn: z.string().min(1, 'kmsKeyArn cannot be empty').optional(),
    snapStartApplyOn: z.enum(['PublishedVersions', 'None']).optional(),
    logFormat: z.enum(['JSON', 'Text']).optional(),
    logGroup: z.string().min(1, 'logGroup cannot be empty').optional(),
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
      return
    }
    if (value.imageUri && value.packageType !== 'Image') {
      ctx.addIssue({
        code: 'custom',
        path: ['packageType'],
        message: 'packageType must be Image when imageUri is set',
      })
    }
    if (hasS3 && value.packageType === 'Image') {
      ctx.addIssue({
        code: 'custom',
        path: ['imageUri'],
        message: 'packageType Image requires imageUri, not an S3 package',
      })
    }
    if (hasS3) {
      if (!value.runtime) {
        ctx.addIssue({
          code: 'custom',
          path: ['runtime'],
          message: 'runtime is required for a .zip deployment package',
        })
      }
      if (!value.handler) {
        ctx.addIssue({
          code: 'custom',
          path: ['handler'],
          message: 'handler is required for a .zip deployment package',
        })
      }
    }
    const subnetIds = value.vpcSubnetIds
    const securityGroupIds = value.vpcSecurityGroupIds
    if ((subnetIds === undefined) !== (securityGroupIds === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [subnetIds === undefined ? 'vpcSubnetIds' : 'vpcSecurityGroupIds'],
        message:
          'vpcSubnetIds and vpcSecurityGroupIds must be supplied together: send both lists to attach a VPC, or both empty to detach',
      })
    } else if (
      subnetIds !== undefined &&
      securityGroupIds !== undefined &&
      (subnetIds.length === 0) !== (securityGroupIds.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [subnetIds.length === 0 ? 'vpcSubnetIds' : 'vpcSecurityGroupIds'],
        message:
          'vpcSubnetIds and vpcSecurityGroupIds must both be empty to detach, or both be populated to attach',
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

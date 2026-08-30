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

const UpdateFunctionConfigurationSchema = z
  .object({
    ...lambdaConnectionFields,
    functionName: z
      .string()
      .min(1, 'functionName is required')
      .max(256, 'functionName cannot exceed 256 characters'),
    role: z.string().optional(),
    runtime: z.string().optional(),
    handler: z.string().optional(),
    description: z.string().max(256, 'description cannot exceed 256 characters').optional(),
    functionTimeout: z.number().int().min(1).max(900).optional(),
    memorySize: z.number().int().min(128).max(32768).optional(),
    ephemeralStorageSize: z.number().int().min(512).max(10240).optional(),
    environment: z.record(z.string(), z.string()).optional(),
    layers: z.array(z.string()).optional(),
    vpcSubnetIds: z.array(z.string()).optional(),
    vpcSecurityGroupIds: z.array(z.string()).optional(),
    tracingMode: z.enum(['Active', 'PassThrough']).optional(),
    deadLetterTargetArn: z.string().optional(),
    kmsKeyArn: z.string().optional(),
    snapStartApplyOn: z.enum(['PublishedVersions', 'None']).optional(),
    logFormat: z.enum(['JSON', 'Text']).optional(),
    logGroup: z.string().optional(),
    revisionId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
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

const UpdateFunctionConfigurationResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    configuration: lambdaFunctionConfigurationSchema,
  }),
})

export const awsLambdaUpdateFunctionConfigurationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/update-function-configuration',
  body: UpdateFunctionConfigurationSchema,
  response: { mode: 'json', schema: UpdateFunctionConfigurationResponseSchema },
})
export type AwsLambdaUpdateFunctionConfigurationRequest = ContractBodyInput<
  typeof awsLambdaUpdateFunctionConfigurationContract
>
export type AwsLambdaUpdateFunctionConfigurationBody = ContractBody<
  typeof awsLambdaUpdateFunctionConfigurationContract
>
export type AwsLambdaUpdateFunctionConfigurationResponse = ContractJsonResponse<
  typeof awsLambdaUpdateFunctionConfigurationContract
>

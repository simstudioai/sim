import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const StartExecutionSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  pipelineName: z
    .string()
    .min(1, 'Pipeline name is required')
    .max(100, 'Pipeline name must be at most 100 characters'),
  clientRequestToken: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9-]+$/, 'Client request token may only contain letters, digits, and hyphens')
    .optional(),
  variables: z
    .array(
      z.object({
        name: z.string().min(1, 'Variable name is required'),
        value: z.string().min(1, 'Variable value cannot be empty'),
      })
    )
    .min(1)
    .max(50)
    .optional(),
})

const StartExecutionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    pipelineExecutionId: z.string(),
  }),
})

export const awsCodepipelineStartExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/start-execution',
  body: StartExecutionSchema,
  response: { mode: 'json', schema: StartExecutionResponseSchema },
})
export type AwsCodepipelineStartExecutionRequest = ContractBodyInput<
  typeof awsCodepipelineStartExecutionContract
>
export type AwsCodepipelineStartExecutionBody = ContractBody<
  typeof awsCodepipelineStartExecutionContract
>
export type AwsCodepipelineStartExecutionResponse = ContractJsonResponse<
  typeof awsCodepipelineStartExecutionContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const RetryStageExecutionSchema = z.object({
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
  stageName: z
    .string()
    .min(1, 'Stage name is required')
    .max(100, 'Stage name must be at most 100 characters'),
  pipelineExecutionId: z.string().min(1, 'Pipeline execution ID is required'),
  retryMode: z.enum(['FAILED_ACTIONS', 'ALL_ACTIONS']),
})

const RetryStageExecutionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    pipelineExecutionId: z.string(),
  }),
})

export const awsCodepipelineRetryStageExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/retry-stage-execution',
  body: RetryStageExecutionSchema,
  response: { mode: 'json', schema: RetryStageExecutionResponseSchema },
})
export type AwsCodepipelineRetryStageExecutionRequest = ContractBodyInput<
  typeof awsCodepipelineRetryStageExecutionContract
>
export type AwsCodepipelineRetryStageExecutionBody = ContractBody<
  typeof awsCodepipelineRetryStageExecutionContract
>
export type AwsCodepipelineRetryStageExecutionResponse = ContractJsonResponse<
  typeof awsCodepipelineRetryStageExecutionContract
>

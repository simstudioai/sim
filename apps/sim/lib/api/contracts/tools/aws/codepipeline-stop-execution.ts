import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const StopExecutionSchema = z.object({
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
  pipelineExecutionId: z.string().min(1, 'Pipeline execution ID is required'),
  abandon: z.boolean().optional(),
  reason: z.string().max(200, 'Stop reason must be at most 200 characters').optional(),
})

const StopExecutionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    pipelineExecutionId: z.string(),
  }),
})

export const awsCodepipelineStopExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/stop-execution',
  body: StopExecutionSchema,
  response: { mode: 'json', schema: StopExecutionResponseSchema },
})
export type AwsCodepipelineStopExecutionRequest = ContractBodyInput<
  typeof awsCodepipelineStopExecutionContract
>
export type AwsCodepipelineStopExecutionBody = ContractBody<
  typeof awsCodepipelineStopExecutionContract
>
export type AwsCodepipelineStopExecutionResponse = ContractJsonResponse<
  typeof awsCodepipelineStopExecutionContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetPipelineExecutionSchema = z.object({
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
})

const GetPipelineExecutionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    pipelineExecutionId: z.string(),
    pipelineName: z.string(),
    pipelineVersion: z.number().optional(),
    status: z.string(),
    statusSummary: z.string().optional(),
    executionMode: z.string().optional(),
    executionType: z.string().optional(),
    triggerType: z.string().optional(),
    triggerDetail: z.string().optional(),
    artifactRevisions: z.array(
      z.object({
        name: z.string(),
        revisionId: z.string().optional(),
        revisionSummary: z.string().optional(),
        revisionUrl: z.string().optional(),
        created: z.number().optional(),
      })
    ),
    variables: z.array(
      z.object({
        name: z.string(),
        resolvedValue: z.string(),
      })
    ),
  }),
})

export const awsCodepipelineGetPipelineExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/get-pipeline-execution',
  body: GetPipelineExecutionSchema,
  response: { mode: 'json', schema: GetPipelineExecutionResponseSchema },
})
export type AwsCodepipelineGetPipelineExecutionRequest = ContractBodyInput<
  typeof awsCodepipelineGetPipelineExecutionContract
>
export type AwsCodepipelineGetPipelineExecutionBody = ContractBody<
  typeof awsCodepipelineGetPipelineExecutionContract
>
export type AwsCodepipelineGetPipelineExecutionResponse = ContractJsonResponse<
  typeof awsCodepipelineGetPipelineExecutionContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetPipelineStateSchema = z.object({
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
})

const ActionStateSchema = z.object({
  actionName: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  lastStatusChange: z.number().optional(),
  externalExecutionId: z.string().optional(),
  externalExecutionUrl: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  percentComplete: z.number().optional(),
  token: z.string().optional(),
  revisionId: z.string().optional(),
  entityUrl: z.string().optional(),
})

const StageStateSchema = z.object({
  stageName: z.string(),
  status: z.string().optional(),
  pipelineExecutionId: z.string().optional(),
  inboundTransitionEnabled: z.boolean().optional(),
  actionStates: z.array(ActionStateSchema),
})

const GetPipelineStateResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    pipelineName: z.string(),
    pipelineVersion: z.number().optional(),
    created: z.number().optional(),
    updated: z.number().optional(),
    stageStates: z.array(StageStateSchema),
  }),
})

export const awsCodepipelineGetPipelineStateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/get-pipeline-state',
  body: GetPipelineStateSchema,
  response: { mode: 'json', schema: GetPipelineStateResponseSchema },
})
export type AwsCodepipelineGetPipelineStateRequest = ContractBodyInput<
  typeof awsCodepipelineGetPipelineStateContract
>
export type AwsCodepipelineGetPipelineStateBody = ContractBody<
  typeof awsCodepipelineGetPipelineStateContract
>
export type AwsCodepipelineGetPipelineStateResponse = ContractJsonResponse<
  typeof awsCodepipelineGetPipelineStateContract
>

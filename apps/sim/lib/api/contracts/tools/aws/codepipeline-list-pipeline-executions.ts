import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListPipelineExecutionsSchema = z.object({
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
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(100).optional()
  ),
  nextToken: z.string().min(1).max(2048).optional(),
  succeededInStage: z.string().min(1).max(100).optional(),
})

const PipelineExecutionSummarySchema = z.object({
  pipelineExecutionId: z.string(),
  status: z.string(),
  statusSummary: z.string().optional(),
  startTime: z.number().optional(),
  lastUpdateTime: z.number().optional(),
  executionMode: z.string().optional(),
  executionType: z.string().optional(),
  stopTriggerReason: z.string().optional(),
  triggerType: z.string().optional(),
  triggerDetail: z.string().optional(),
  rollbackTargetPipelineExecutionId: z.string().optional(),
  sourceRevisions: z.array(
    z.object({
      actionName: z.string(),
      revisionId: z.string().optional(),
      revisionSummary: z.string().optional(),
      revisionUrl: z.string().optional(),
    })
  ),
})

const ListPipelineExecutionsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    executions: z.array(PipelineExecutionSummarySchema),
    nextToken: z.string().optional(),
  }),
})

export const awsCodepipelineListPipelineExecutionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/list-pipeline-executions',
  body: ListPipelineExecutionsSchema,
  response: { mode: 'json', schema: ListPipelineExecutionsResponseSchema },
})
export type AwsCodepipelineListPipelineExecutionsRequest = ContractBodyInput<
  typeof awsCodepipelineListPipelineExecutionsContract
>
export type AwsCodepipelineListPipelineExecutionsBody = ContractBody<
  typeof awsCodepipelineListPipelineExecutionsContract
>
export type AwsCodepipelineListPipelineExecutionsResponse = ContractJsonResponse<
  typeof awsCodepipelineListPipelineExecutionsContract
>

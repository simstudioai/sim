import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListActionExecutionsSchema = z.object({
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
  pipelineExecutionId: z.string().min(1).optional(),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(100).optional()
  ),
  nextToken: z.string().min(1).max(2048).optional(),
})

const ActionExecutionDetailSchema = z.object({
  pipelineExecutionId: z.string().optional(),
  actionExecutionId: z.string().optional(),
  pipelineVersion: z.number().optional(),
  stageName: z.string().optional(),
  actionName: z.string().optional(),
  startTime: z.number().optional(),
  lastUpdateTime: z.number().optional(),
  updatedBy: z.string().optional(),
  status: z.string().optional(),
  externalExecutionId: z.string().optional(),
  externalExecutionSummary: z.string().optional(),
  externalExecutionUrl: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
})

const ListActionExecutionsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    actionExecutionDetails: z.array(ActionExecutionDetailSchema),
    nextToken: z.string().optional(),
  }),
})

export const awsCodepipelineListActionExecutionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/list-action-executions',
  body: ListActionExecutionsSchema,
  response: { mode: 'json', schema: ListActionExecutionsResponseSchema },
})
export type AwsCodepipelineListActionExecutionsRequest = ContractBodyInput<
  typeof awsCodepipelineListActionExecutionsContract
>
export type AwsCodepipelineListActionExecutionsBody = ContractBody<
  typeof awsCodepipelineListActionExecutionsContract
>
export type AwsCodepipelineListActionExecutionsResponse = ContractJsonResponse<
  typeof awsCodepipelineListActionExecutionsContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DisableStageTransitionSchema = z.object({
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
  transitionType: z.enum(['Inbound', 'Outbound']),
  reason: z.string().min(1, 'Reason is required').max(300, 'Reason must be at most 300 characters'),
})

const DisableStageTransitionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    pipelineName: z.string(),
    stageName: z.string(),
    transitionType: z.enum(['Inbound', 'Outbound']),
  }),
})

export const awsCodepipelineDisableStageTransitionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/disable-stage-transition',
  body: DisableStageTransitionSchema,
  response: { mode: 'json', schema: DisableStageTransitionResponseSchema },
})
export type AwsCodepipelineDisableStageTransitionRequest = ContractBodyInput<
  typeof awsCodepipelineDisableStageTransitionContract
>
export type AwsCodepipelineDisableStageTransitionBody = ContractBody<
  typeof awsCodepipelineDisableStageTransitionContract
>
export type AwsCodepipelineDisableStageTransitionResponse = ContractJsonResponse<
  typeof awsCodepipelineDisableStageTransitionContract
>

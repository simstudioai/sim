import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListPipelinesSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(1000).optional()
  ),
  nextToken: z.string().min(1).max(2048).optional(),
})

const ListPipelinesResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    pipelines: z.array(
      z.object({
        name: z.string(),
        version: z.number().optional(),
        pipelineType: z.string().optional(),
        executionMode: z.string().optional(),
        created: z.number().optional(),
        updated: z.number().optional(),
      })
    ),
    nextToken: z.string().optional(),
  }),
})

export const awsCodepipelineListPipelinesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/list-pipelines',
  body: ListPipelinesSchema,
  response: { mode: 'json', schema: ListPipelinesResponseSchema },
})
export type AwsCodepipelineListPipelinesRequest = ContractBodyInput<
  typeof awsCodepipelineListPipelinesContract
>
export type AwsCodepipelineListPipelinesBody = ContractBody<
  typeof awsCodepipelineListPipelinesContract
>
export type AwsCodepipelineListPipelinesResponse = ContractJsonResponse<
  typeof awsCodepipelineListPipelinesContract
>

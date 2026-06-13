import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const PutApprovalResultSchema = z.object({
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
  actionName: z
    .string()
    .min(1, 'Action name is required')
    .max(100, 'Action name must be at most 100 characters'),
  token: z.string().min(1, 'Approval token is required'),
  status: z.enum(['Approved', 'Rejected']),
  summary: z
    .string()
    .min(1, 'Approval summary is required')
    .max(512, 'Approval summary must be at most 512 characters'),
})

const PutApprovalResultResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    approvedAt: z.number().optional(),
    status: z.string(),
  }),
})

export const awsCodepipelinePutApprovalResultContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/put-approval-result',
  body: PutApprovalResultSchema,
  response: { mode: 'json', schema: PutApprovalResultResponseSchema },
})
export type AwsCodepipelinePutApprovalResultRequest = ContractBodyInput<
  typeof awsCodepipelinePutApprovalResultContract
>
export type AwsCodepipelinePutApprovalResultBody = ContractBody<
  typeof awsCodepipelinePutApprovalResultContract
>
export type AwsCodepipelinePutApprovalResultResponse = ContractJsonResponse<
  typeof awsCodepipelinePutApprovalResultContract
>

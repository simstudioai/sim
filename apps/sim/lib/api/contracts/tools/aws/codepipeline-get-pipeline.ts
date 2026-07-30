import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetPipelineSchema = z.object({
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
  version: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).optional()
  ),
})

const ActionDeclarationSchema = z.object({
  name: z.string(),
  category: z.string(),
  owner: z.string(),
  provider: z.string(),
  version: z.string(),
  runOrder: z.number().optional(),
  configuration: z.record(z.string(), z.string()),
  inputArtifacts: z.array(z.string()),
  outputArtifacts: z.array(z.string()),
})

const StageDeclarationSchema = z.object({
  stageName: z.string(),
  actions: z.array(ActionDeclarationSchema),
})

const GetPipelineResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    pipelineName: z.string(),
    pipelineArn: z.string().optional(),
    roleArn: z.string(),
    version: z.number().optional(),
    pipelineType: z.string().optional(),
    executionMode: z.string().optional(),
    artifactStoreType: z.string().optional(),
    artifactStoreLocation: z.string().optional(),
    stages: z.array(StageDeclarationSchema),
    variables: z.array(
      z.object({
        name: z.string(),
        defaultValue: z.string().optional(),
        description: z.string().optional(),
      })
    ),
    created: z.number().optional(),
    updated: z.number().optional(),
  }),
})

export const awsCodepipelineGetPipelineContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/codepipeline/get-pipeline',
  body: GetPipelineSchema,
  response: { mode: 'json', schema: GetPipelineResponseSchema },
})
export type AwsCodepipelineGetPipelineRequest = ContractBodyInput<
  typeof awsCodepipelineGetPipelineContract
>
export type AwsCodepipelineGetPipelineBody = ContractBody<typeof awsCodepipelineGetPipelineContract>
export type AwsCodepipelineGetPipelineResponse = ContractJsonResponse<
  typeof awsCodepipelineGetPipelineContract
>

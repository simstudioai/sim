import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const INSTANCE_ID_PATTERN = /^(i-(\w{8}|\w{17})|mi-\w{17})$/

const PatchOrchestratorFilterSchema = z.object({
  Key: z.string().min(1, 'Filter Key must not be empty').max(128).optional(),
  Values: z.array(z.string().min(1).max(256)).min(1).optional(),
})

const PatchComplianceDataSchema = z.object({
  title: z.string(),
  kbId: z.string(),
  classification: z.string(),
  severity: z.string(),
  state: z.string(),
  installedTime: z.string().nullable(),
  cveIds: z.string().nullable(),
})

const RequestSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  instanceId: z.string().regex(INSTANCE_ID_PATTERN, 'instanceId must look like i-0abc… or mi-…'),
  filters: z.array(PatchOrchestratorFilterSchema).max(5).nullish(),
  maxResults: z.number().int().min(10).max(100).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  patches: z.array(PatchComplianceDataSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmDescribeInstancePatchesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/describe-instance-patches',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmDescribeInstancePatchesRequest = ContractBodyInput<
  typeof awsSsmDescribeInstancePatchesContract
>
export type AwsSsmDescribeInstancePatchesBody = ContractBody<
  typeof awsSsmDescribeInstancePatchesContract
>
export type AwsSsmDescribeInstancePatchesResponse = ContractJsonResponse<
  typeof awsSsmDescribeInstancePatchesContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ExecuteChangeSetSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  changeSetName: z.string().min(1, 'Change set name is required'),
  stackName: z.string().optional(),
})

const ExecuteChangeSetResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    message: z.string(),
  }),
})

export const awsCloudformationExecuteChangeSetContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/execute-change-set',
  body: ExecuteChangeSetSchema,
  response: { mode: 'json', schema: ExecuteChangeSetResponseSchema },
})
export type AwsCloudformationExecuteChangeSetRequest = ContractBodyInput<
  typeof awsCloudformationExecuteChangeSetContract
>
export type AwsCloudformationExecuteChangeSetBody = ContractBody<
  typeof awsCloudformationExecuteChangeSetContract
>
export type AwsCloudformationExecuteChangeSetResponse = ContractJsonResponse<
  typeof awsCloudformationExecuteChangeSetContract
>

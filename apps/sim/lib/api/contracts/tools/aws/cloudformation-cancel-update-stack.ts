import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const CancelUpdateStackSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
})

const CancelUpdateStackResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    message: z.string(),
  }),
})

export const awsCloudformationCancelUpdateStackContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/cancel-update-stack',
  body: CancelUpdateStackSchema,
  response: { mode: 'json', schema: CancelUpdateStackResponseSchema },
})
export type AwsCloudformationCancelUpdateStackRequest = ContractBodyInput<
  typeof awsCloudformationCancelUpdateStackContract
>
export type AwsCloudformationCancelUpdateStackBody = ContractBody<
  typeof awsCloudformationCancelUpdateStackContract
>
export type AwsCloudformationCancelUpdateStackResponse = ContractJsonResponse<
  typeof awsCloudformationCancelUpdateStackContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CancelUpdateStackSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
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

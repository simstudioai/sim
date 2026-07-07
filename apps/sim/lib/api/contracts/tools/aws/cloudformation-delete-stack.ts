import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteStackSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
  retainResources: z.string().optional(),
})

const DeleteStackResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    message: z.string(),
  }),
})

export const awsCloudformationDeleteStackContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/delete-stack',
  body: DeleteStackSchema,
  response: { mode: 'json', schema: DeleteStackResponseSchema },
})
export type AwsCloudformationDeleteStackRequest = ContractBodyInput<
  typeof awsCloudformationDeleteStackContract
>
export type AwsCloudformationDeleteStackBody = ContractBody<
  typeof awsCloudformationDeleteStackContract
>
export type AwsCloudformationDeleteStackResponse = ContractJsonResponse<
  typeof awsCloudformationDeleteStackContract
>

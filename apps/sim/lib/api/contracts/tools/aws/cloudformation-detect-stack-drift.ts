import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DetectStackDriftSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
})

const DetectStackDriftResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    stackDriftDetectionId: z.string(),
  }),
})

export const awsCloudformationDetectStackDriftContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/detect-stack-drift',
  body: DetectStackDriftSchema,
  response: { mode: 'json', schema: DetectStackDriftResponseSchema },
})
export type AwsCloudformationDetectStackDriftRequest = ContractBodyInput<
  typeof awsCloudformationDetectStackDriftContract
>
export type AwsCloudformationDetectStackDriftBody = ContractBody<
  typeof awsCloudformationDetectStackDriftContract
>
export type AwsCloudformationDetectStackDriftResponse = ContractJsonResponse<
  typeof awsCloudformationDetectStackDriftContract
>

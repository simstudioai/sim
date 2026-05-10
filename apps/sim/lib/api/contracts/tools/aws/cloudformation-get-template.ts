import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetTemplateSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
})

const GetTemplateResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    templateBody: z.string(),
    stagesAvailable: z.array(z.string()),
  }),
})

export const awsCloudformationGetTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/get-template',
  body: GetTemplateSchema,
  response: { mode: 'json', schema: GetTemplateResponseSchema },
})
type AwsCloudformationGetTemplateRequest = ContractBodyInput<
  typeof awsCloudformationGetTemplateContract
>
type AwsCloudformationGetTemplateBody = ContractBody<typeof awsCloudformationGetTemplateContract>
type AwsCloudformationGetTemplateResponse = ContractJsonResponse<
  typeof awsCloudformationGetTemplateContract
>

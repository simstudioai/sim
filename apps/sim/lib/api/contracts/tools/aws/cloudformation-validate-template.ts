import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ValidateTemplateSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  templateBody: z.string().min(1, 'Template body is required'),
})

const ValidateTemplateResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    description: z.string().optional(),
    parameters: z.array(
      z.object({
        parameterKey: z.string().optional(),
        defaultValue: z.string().optional(),
        noEcho: z.boolean().optional(),
        description: z.string().optional(),
      })
    ),
    capabilities: z.array(z.string()),
    capabilitiesReason: z.string().optional(),
    declaredTransforms: z.array(z.string()),
  }),
})

export const awsCloudformationValidateTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/validate-template',
  body: ValidateTemplateSchema,
  response: { mode: 'json', schema: ValidateTemplateResponseSchema },
})
export type AwsCloudformationValidateTemplateRequest = ContractBodyInput<
  typeof awsCloudformationValidateTemplateContract
>
export type AwsCloudformationValidateTemplateBody = ContractBody<
  typeof awsCloudformationValidateTemplateContract
>
export type AwsCloudformationValidateTemplateResponse = ContractJsonResponse<
  typeof awsCloudformationValidateTemplateContract
>

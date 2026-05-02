import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DeleteTemplateSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  templateName: z.string().min(1, 'Template name is required'),
})

const DeleteTemplateResponseSchema = z.object({
  message: z.string(),
})

export const awsSesDeleteTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/delete-template',
  body: DeleteTemplateSchema,
  response: { mode: 'json', schema: DeleteTemplateResponseSchema },
})
export type AwsSesDeleteTemplateRequest = ContractBodyInput<typeof awsSesDeleteTemplateContract>
export type AwsSesDeleteTemplateBody = ContractBody<typeof awsSesDeleteTemplateContract>
export type AwsSesDeleteTemplateResponse = ContractJsonResponse<typeof awsSesDeleteTemplateContract>

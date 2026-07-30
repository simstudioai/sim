import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const UpdateTemplateSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  templateName: z.string().min(1, 'Template name is required'),
  subjectPart: z.string().min(1, 'Template subject is required'),
  textPart: z.string().nullish(),
  htmlPart: z.string().nullish(),
})

const UpdateTemplateResponseSchema = z.object({
  message: z.string(),
})

export const awsSesUpdateTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/update-template',
  body: UpdateTemplateSchema,
  response: { mode: 'json', schema: UpdateTemplateResponseSchema },
})
export type AwsSesUpdateTemplateRequest = ContractBodyInput<typeof awsSesUpdateTemplateContract>
export type AwsSesUpdateTemplateBody = ContractBody<typeof awsSesUpdateTemplateContract>
export type AwsSesUpdateTemplateResponse = ContractJsonResponse<typeof awsSesUpdateTemplateContract>

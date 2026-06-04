import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetTemplateSchema = z.object({
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

const GetTemplateResponseSchema = z.object({
  templateName: z.string(),
  subjectPart: z.string(),
  textPart: z.string().nullable(),
  htmlPart: z.string().nullable(),
})

export const awsSesGetTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/get-template',
  body: GetTemplateSchema,
  response: { mode: 'json', schema: GetTemplateResponseSchema },
})
export type AwsSesGetTemplateRequest = ContractBodyInput<typeof awsSesGetTemplateContract>
export type AwsSesGetTemplateBody = ContractBody<typeof awsSesGetTemplateContract>
export type AwsSesGetTemplateResponse = ContractJsonResponse<typeof awsSesGetTemplateContract>

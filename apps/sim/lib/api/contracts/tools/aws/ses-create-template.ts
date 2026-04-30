import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const CreateTemplateSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    templateName: z.string().min(1, 'Template name is required'),
    subjectPart: z.string().min(1, 'Subject is required'),
    textPart: z.string().nullish(),
    htmlPart: z.string().nullish(),
  })
  .refine((data) => data.textPart || data.htmlPart, {
    message: 'At least one of textPart or htmlPart is required',
    path: ['textPart'],
  })

const CreateTemplateResponseSchema = z.object({
  message: z.string(),
})

export const awsSesCreateTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/create-template',
  body: CreateTemplateSchema,
  response: { mode: 'json', schema: CreateTemplateResponseSchema },
})
export type AwsSesCreateTemplateRequest = ContractBodyInput<typeof awsSesCreateTemplateContract>
export type AwsSesCreateTemplateBody = ContractBody<typeof awsSesCreateTemplateContract>
export type AwsSesCreateTemplateResponse = ContractJsonResponse<typeof awsSesCreateTemplateContract>

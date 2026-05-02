import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DestinationSchema = z.object({
  toAddresses: z.array(z.string().email()),
  templateData: z.string().optional(),
})

const SendBulkEmailSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  fromAddress: z.string().email('Valid sender email address is required'),
  templateName: z.string().min(1, 'Template name is required'),
  destinations: z.string().min(1, 'Destinations JSON array is required'),
  defaultTemplateData: z.string().nullish(),
  configurationSetName: z.string().nullish(),
})

const SendBulkEmailResponseSchema = z.object({
  results: z.array(
    z.object({
      messageId: z.string().nullable(),
      status: z.string(),
      error: z.string().nullable(),
    })
  ),
  successCount: z.number(),
  failureCount: z.number(),
})

export const awsSesSendBulkEmailContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/send-bulk-email',
  body: SendBulkEmailSchema,
  response: { mode: 'json', schema: SendBulkEmailResponseSchema },
})
export type AwsSesSendBulkEmailRequest = ContractBodyInput<typeof awsSesSendBulkEmailContract>
export type AwsSesSendBulkEmailBody = ContractBody<typeof awsSesSendBulkEmailContract>
export type AwsSesSendBulkEmailResponse = ContractJsonResponse<typeof awsSesSendBulkEmailContract>

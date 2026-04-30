import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const SendEmailSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    fromAddress: z.string().email('Valid sender email address is required'),
    toAddresses: z.string().min(1, 'At least one recipient address is required'),
    subject: z.string().min(1, 'Email subject is required'),
    bodyText: z.string().nullish(),
    bodyHtml: z.string().nullish(),
    ccAddresses: z.string().nullish(),
    bccAddresses: z.string().nullish(),
    replyToAddresses: z.string().nullish(),
    configurationSetName: z.string().nullish(),
  })
  .refine((data) => data.bodyText || data.bodyHtml, {
    message: 'At least one of bodyText or bodyHtml is required',
    path: ['bodyText'],
  })

const SendEmailResponseSchema = z.object({
  messageId: z.string(),
})

export const awsSesSendEmailContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/send-email',
  body: SendEmailSchema,
  response: { mode: 'json', schema: SendEmailResponseSchema },
})
export type AwsSesSendEmailRequest = ContractBodyInput<typeof awsSesSendEmailContract>
export type AwsSesSendEmailBody = ContractBody<typeof awsSesSendEmailContract>
export type AwsSesSendEmailResponse = ContractJsonResponse<typeof awsSesSendEmailContract>

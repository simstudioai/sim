import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const SendCustomVerificationEmailSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  emailAddress: z.string().email('A valid email address is required'),
  templateName: z.string().min(1, 'Custom verification template name is required'),
  configurationSetName: z.string().nullish(),
})

const SendCustomVerificationEmailResponseSchema = z.object({
  messageId: z.string(),
})

export const awsSesSendCustomVerificationEmailContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/send-custom-verification-email',
  body: SendCustomVerificationEmailSchema,
  response: { mode: 'json', schema: SendCustomVerificationEmailResponseSchema },
})
export type AwsSesSendCustomVerificationEmailRequest = ContractBodyInput<
  typeof awsSesSendCustomVerificationEmailContract
>
export type AwsSesSendCustomVerificationEmailBody = ContractBody<
  typeof awsSesSendCustomVerificationEmailContract
>
export type AwsSesSendCustomVerificationEmailResponse = ContractJsonResponse<
  typeof awsSesSendCustomVerificationEmailContract
>

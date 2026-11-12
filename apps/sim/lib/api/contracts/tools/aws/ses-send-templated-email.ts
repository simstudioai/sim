import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/** SES `MessageTag` name or value: 1-256 letters, digits, underscores, or hyphens. */
const sesMessageTagPartSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,256}$/, 'Tag names and values may contain only letters, digits, _ and -')

const SendTemplatedEmailSchema = z.object({
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
  templateName: z.string().min(1, 'Template name is required'),
  templateData: z.string().min(1, 'Template data is required'),
  ccAddresses: z.string().nullish(),
  bccAddresses: z.string().nullish(),
  configurationSetName: z.string().nullish(),
  replyToAddresses: z.string().nullish(),
  fromName: z.string().nullish(),
  emailTags: z
    .array(z.object({ name: sesMessageTagPartSchema, value: sesMessageTagPartSchema }))
    .nullish(),
})

const SendTemplatedEmailResponseSchema = z.object({
  messageId: z.string(),
})

export const awsSesSendTemplatedEmailContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/send-templated-email',
  body: SendTemplatedEmailSchema,
  response: { mode: 'json', schema: SendTemplatedEmailResponseSchema },
})
export type AwsSesSendTemplatedEmailRequest = ContractBodyInput<
  typeof awsSesSendTemplatedEmailContract
>
export type AwsSesSendTemplatedEmailBody = ContractBody<typeof awsSesSendTemplatedEmailContract>
export type AwsSesSendTemplatedEmailResponse = ContractJsonResponse<
  typeof awsSesSendTemplatedEmailContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetEmailIdentitySchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  emailIdentity: z.string().min(1, 'Email identity (domain or address) is required'),
})

const DkimAttributesSchema = z.object({
  signingEnabled: z.boolean().nullable(),
  status: z.string().nullable(),
  tokens: z.array(z.string()),
  signingAttributesOrigin: z.string().nullable(),
  nextSigningKeyLength: z.string().nullable(),
  currentSigningKeyLength: z.string().nullable(),
  lastKeyGenerationTimestamp: z.string().nullable(),
  signingHostedZone: z.string().nullable(),
})

const GetEmailIdentityResponseSchema = z.object({
  identityType: z.string(),
  verifiedForSendingStatus: z.boolean(),
  verificationStatus: z.string().nullable(),
  feedbackForwardingStatus: z.boolean().nullable(),
  configurationSetName: z.string().nullable(),
  dkimAttributes: DkimAttributesSchema.nullable(),
  mailFromAttributes: z
    .object({
      mailFromDomain: z.string().nullable(),
      mailFromDomainStatus: z.string().nullable(),
      behaviorOnMxFailure: z.string().nullable(),
    })
    .nullable(),
  policies: z.record(z.string(), z.string()).nullable(),
  tags: z.array(z.object({ key: z.string(), value: z.string() })),
  verificationInfo: z
    .object({
      errorType: z.string().nullable(),
      lastCheckedTimestamp: z.string().nullable(),
      lastSuccessTimestamp: z.string().nullable(),
    })
    .nullable(),
})

export const awsSesGetEmailIdentityContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/get-email-identity',
  body: GetEmailIdentitySchema,
  response: { mode: 'json', schema: GetEmailIdentityResponseSchema },
})
export type AwsSesGetEmailIdentityRequest = ContractBodyInput<typeof awsSesGetEmailIdentityContract>
export type AwsSesGetEmailIdentityBody = ContractBody<typeof awsSesGetEmailIdentityContract>
export type AwsSesGetEmailIdentityResponse = ContractJsonResponse<
  typeof awsSesGetEmailIdentityContract
>

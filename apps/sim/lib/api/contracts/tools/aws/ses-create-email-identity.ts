import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const CreateEmailIdentitySchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  emailIdentity: z.string().min(1, 'Email identity (domain or address) is required'),
  dkimSigningAttributes: z
    .object({
      domainSigningSelector: z.string().optional(),
      domainSigningPrivateKey: z.string().optional(),
      nextSigningKeyLength: z.enum(['RSA_1024_BIT', 'RSA_2048_BIT']).optional(),
    })
    .nullish(),
  tags: z
    .array(
      z.object({
        key: z
          .string()
          .min(1, 'Tag key is required')
          .max(128, 'Tag key must be at most 128 characters'),
        value: z.string().max(256, 'Tag value must be at most 256 characters'),
      })
    )
    .nullish(),
  configurationSetName: z.string().nullish(),
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

const CreateEmailIdentityResponseSchema = z.object({
  identityType: z.string(),
  verifiedForSendingStatus: z.boolean(),
  dkimAttributes: DkimAttributesSchema.nullable(),
})

export const awsSesCreateEmailIdentityContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/create-email-identity',
  body: CreateEmailIdentitySchema,
  response: { mode: 'json', schema: CreateEmailIdentityResponseSchema },
})
export type AwsSesCreateEmailIdentityRequest = ContractBodyInput<
  typeof awsSesCreateEmailIdentityContract
>
export type AwsSesCreateEmailIdentityBody = ContractBody<typeof awsSesCreateEmailIdentityContract>
export type AwsSesCreateEmailIdentityResponse = ContractJsonResponse<
  typeof awsSesCreateEmailIdentityContract
>

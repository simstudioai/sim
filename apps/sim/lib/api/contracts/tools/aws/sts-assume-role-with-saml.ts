import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const AssumeRoleWithSAMLSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  roleArn: z.string().min(20, 'Role ARN is required').max(2048),
  principalArn: z.string().min(20, 'SAML provider ARN is required').max(2048),
  samlAssertion: z
    .string()
    .min(4, 'SAML assertion is required')
    .max(100000, 'SAML assertion must not exceed 100000 characters'),
  policy: z.string().max(2048).nullish(),
  policyArns: z
    .string()
    .nullish()
    .refine((v) => !v || v.split(',').filter((arn) => arn.trim().length > 0).length <= 10, {
      message: 'A maximum of 10 policy ARNs can be provided',
    }),
  durationSeconds: z.number().int().min(900).max(43200).nullish(),
})

const AssumeRoleWithSAMLResponseSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string(),
  expiration: z.string().nullable(),
  assumedRoleArn: z.string(),
  assumedRoleId: z.string(),
  subject: z.string().nullable(),
  subjectType: z.string().nullable(),
  issuer: z.string().nullable(),
  audience: z.string().nullable(),
  nameQualifier: z.string().nullable(),
  packedPolicySize: z.number().nullable(),
  sourceIdentity: z.string().nullable(),
})

export const awsStsAssumeRoleWithSAMLContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sts/assume-role-with-saml',
  body: AssumeRoleWithSAMLSchema,
  response: { mode: 'json', schema: AssumeRoleWithSAMLResponseSchema },
})
export type AwsStsAssumeRoleWithSAMLRequest = ContractBodyInput<
  typeof awsStsAssumeRoleWithSAMLContract
>
export type AwsStsAssumeRoleWithSAMLBody = ContractBody<typeof awsStsAssumeRoleWithSAMLContract>
export type AwsStsAssumeRoleWithSAMLResponse = ContractJsonResponse<
  typeof awsStsAssumeRoleWithSAMLContract
>

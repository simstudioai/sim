import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const AssumeRoleWithWebIdentitySchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  roleArn: z.string().min(20, 'Role ARN is required').max(2048),
  roleSessionName: z.string().min(2, 'Role session name is required').max(64),
  webIdentityToken: z
    .string()
    .min(4, 'Web identity token is required')
    .max(20000, 'Web identity token must not exceed 20000 characters'),
  providerId: z.string().min(4).max(2048).nullish(),
  policy: z.string().max(2048).nullish(),
  policyArns: z
    .string()
    .nullish()
    .refine((v) => !v || v.split(',').filter((arn) => arn.trim().length > 0).length <= 10, {
      message: 'A maximum of 10 policy ARNs can be provided',
    }),
  durationSeconds: z.number().int().min(900).max(43200).nullish(),
})

const AssumeRoleWithWebIdentityResponseSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string(),
  expiration: z.string().nullable(),
  assumedRoleArn: z.string(),
  assumedRoleId: z.string(),
  subjectFromWebIdentityToken: z.string(),
  audience: z.string().nullable(),
  provider: z.string().nullable(),
  packedPolicySize: z.number().nullable(),
  sourceIdentity: z.string().nullable(),
})

export const awsStsAssumeRoleWithWebIdentityContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sts/assume-role-with-web-identity',
  body: AssumeRoleWithWebIdentitySchema,
  response: { mode: 'json', schema: AssumeRoleWithWebIdentityResponseSchema },
})
export type AwsStsAssumeRoleWithWebIdentityRequest = ContractBodyInput<
  typeof awsStsAssumeRoleWithWebIdentityContract
>
export type AwsStsAssumeRoleWithWebIdentityBody = ContractBody<
  typeof awsStsAssumeRoleWithWebIdentityContract
>
export type AwsStsAssumeRoleWithWebIdentityResponse = ContractJsonResponse<
  typeof awsStsAssumeRoleWithWebIdentityContract
>

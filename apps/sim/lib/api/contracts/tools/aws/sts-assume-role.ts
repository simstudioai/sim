import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const AssumeRoleSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  roleArn: z.string().min(1, 'Role ARN is required'),
  roleSessionName: z.string().min(1, 'Role session name is required'),
  durationSeconds: z.number().int().min(900).max(43200).nullish(),
  policy: z.string().max(2048).nullish(),
  externalId: z.string().min(2).max(1224).nullish(),
  serialNumber: z.string().nullish(),
  tokenCode: z.string().nullish(),
  policyArns: z
    .string()
    .nullish()
    .refine((v) => !v || v.split(',').filter((arn) => arn.trim().length > 0).length <= 10, {
      message: 'A maximum of 10 policy ARNs can be provided',
    }),
  tags: z
    .string()
    .nullish()
    .refine(
      (v) => {
        if (!v) return true
        try {
          const parsed = JSON.parse(v)
          return isRecordLike(parsed)
        } catch {
          return false
        }
      },
      { message: 'tags must be a valid JSON object string' }
    ),
  transitiveTagKeys: z
    .string()
    .nullish()
    .refine((v) => !v || v.split(',').filter((key) => key.trim().length > 0).length <= 50, {
      message: 'A maximum of 50 transitive tag keys can be provided',
    }),
})

const AssumeRoleResponseSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string(),
  expiration: z.string().nullable(),
  assumedRoleArn: z.string(),
  assumedRoleId: z.string(),
  packedPolicySize: z.number().nullable(),
  sourceIdentity: z.string().nullable(),
})

export const awsStsAssumeRoleContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sts/assume-role',
  body: AssumeRoleSchema,
  response: { mode: 'json', schema: AssumeRoleResponseSchema },
})
export type AwsStsAssumeRoleRequest = ContractBodyInput<typeof awsStsAssumeRoleContract>
export type AwsStsAssumeRoleBody = ContractBody<typeof awsStsAssumeRoleContract>
export type AwsStsAssumeRoleResponse = ContractJsonResponse<typeof awsStsAssumeRoleContract>

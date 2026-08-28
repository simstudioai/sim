import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const regionSchema = z
  .string()
  .min(1, 'AWS region is required')
  .refine((value) => validateAwsRegion(value).isValid, {
    message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
  })

const authenticatedInputSchema = z.object({
  region: regionSchema,
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
})

const policyArnsSchema = z
  .string()
  .nullish()
  .refine(
    (value) => !value || value.split(',').filter((arn) => arn.trim().length > 0).length <= 10,
    { message: 'A maximum of 10 policy ARNs can be provided' }
  )

export const stsAssumeRoleInputSchema = authenticatedInputSchema.extend({
  roleArn: z.string().min(1, 'Role ARN is required'),
  roleSessionName: z.string().min(1, 'Role session name is required'),
  durationSeconds: z.number().int().min(900).max(43200).nullish(),
  policy: z.string().max(2048).nullish(),
  externalId: z.string().min(2).max(1224).nullish(),
  serialNumber: z.string().nullish(),
  tokenCode: z.string().nullish(),
  policyArns: policyArnsSchema,
  tags: z
    .string()
    .nullish()
    .refine(
      (value) => {
        if (!value) return true
        try {
          return isRecordLike(JSON.parse(value))
        } catch {
          return false
        }
      },
      { message: 'tags must be a valid JSON object string' }
    ),
  transitiveTagKeys: z
    .string()
    .nullish()
    .refine(
      (value) => !value || value.split(',').filter((key) => key.trim().length > 0).length <= 50,
      { message: 'A maximum of 50 transitive tag keys can be provided' }
    ),
})

export const stsAssumeRoleWithWebIdentityInputSchema = z.object({
  region: regionSchema,
  roleArn: z.string().min(20, 'Role ARN is required').max(2048),
  roleSessionName: z.string().min(2, 'Role session name is required').max(64),
  webIdentityToken: z
    .string()
    .min(4, 'Web identity token is required')
    .max(20000, 'Web identity token must not exceed 20000 characters'),
  providerId: z.string().min(4).max(2048).nullish(),
  policy: z.string().max(2048).nullish(),
  policyArns: policyArnsSchema,
  durationSeconds: z.number().int().min(900).max(43200).nullish(),
})

export const stsAssumeRoleWithSamlInputSchema = z.object({
  region: regionSchema,
  roleArn: z.string().min(20, 'Role ARN is required').max(2048),
  principalArn: z.string().min(20, 'SAML provider ARN is required').max(2048),
  samlAssertion: z
    .string()
    .min(4, 'SAML assertion is required')
    .max(100000, 'SAML assertion must not exceed 100000 characters'),
  policy: z.string().max(2048).nullish(),
  policyArns: policyArnsSchema,
  durationSeconds: z.number().int().min(900).max(43200).nullish(),
})

export const stsGetCallerIdentityInputSchema = authenticatedInputSchema

export const stsGetSessionTokenInputSchema = authenticatedInputSchema.extend({
  durationSeconds: z.number().int().min(900).max(129600).nullish(),
  serialNumber: z.string().nullish(),
  tokenCode: z.string().nullish(),
})

export const stsGetAccessKeyInfoInputSchema = authenticatedInputSchema.extend({
  targetAccessKeyId: z.string().min(1, 'Target access key ID is required'),
})

export type StsAssumeRoleInput = z.output<typeof stsAssumeRoleInputSchema>
export type StsAssumeRoleWithWebIdentityInput = z.output<
  typeof stsAssumeRoleWithWebIdentityInputSchema
>
export type StsAssumeRoleWithSamlInput = z.output<typeof stsAssumeRoleWithSamlInputSchema>
export type StsGetCallerIdentityInput = z.output<typeof stsGetCallerIdentityInputSchema>
export type StsGetSessionTokenInput = z.output<typeof stsGetSessionTokenInputSchema>
export type StsGetAccessKeyInfoInput = z.output<typeof stsGetAccessKeyInfoInputSchema>

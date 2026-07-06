import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const CreateConfigurationSetSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    configurationSetName: z
      .string()
      .min(1, 'Configuration set name is required')
      .max(64, 'Configuration set name must be 64 characters or fewer')
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        'Configuration set name may only contain letters, numbers, hyphens, and underscores'
      ),
    customRedirectDomain: z.string().nullish(),
    httpsPolicy: z.enum(['REQUIRE', 'REQUIRE_OPEN_ONLY', 'OPTIONAL']).nullish(),
    tlsPolicy: z.enum(['REQUIRE', 'OPTIONAL']).nullish(),
    sendingPoolName: z.string().nullish(),
    reputationMetricsEnabled: z.boolean().nullish(),
    sendingEnabled: z.boolean().nullish(),
    suppressedReasons: z.string().nullish(),
    tags: z.string().nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.httpsPolicy && !data.customRedirectDomain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'customRedirectDomain is required when httpsPolicy is set (AWS TrackingOptions requires a redirect domain)',
        path: ['customRedirectDomain'],
      })
    }
  })

const CreateConfigurationSetResponseSchema = z.object({
  message: z.string(),
})

export const awsSesCreateConfigurationSetContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/create-configuration-set',
  body: CreateConfigurationSetSchema,
  response: { mode: 'json', schema: CreateConfigurationSetResponseSchema },
})
export type AwsSesCreateConfigurationSetRequest = ContractBodyInput<
  typeof awsSesCreateConfigurationSetContract
>
export type AwsSesCreateConfigurationSetBody = ContractBody<
  typeof awsSesCreateConfigurationSetContract
>
export type AwsSesCreateConfigurationSetResponse = ContractJsonResponse<
  typeof awsSesCreateConfigurationSetContract
>

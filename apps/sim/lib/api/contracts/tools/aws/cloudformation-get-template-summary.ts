import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetTemplateSummarySchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    templateBody: z.string().optional(),
    stackName: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.templateBody && !data.stackName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either templateBody or stackName is required',
        path: ['templateBody'],
      })
    }
  })

const GetTemplateSummaryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    description: z.string().optional(),
    parameters: z.array(
      z.object({
        parameterKey: z.string().optional(),
        defaultValue: z.string().optional(),
        parameterType: z.string().optional(),
        noEcho: z.boolean().optional(),
        description: z.string().optional(),
      })
    ),
    capabilities: z.array(z.string()),
    capabilitiesReason: z.string().optional(),
    resourceTypes: z.array(z.string()),
    version: z.string().optional(),
    declaredTransforms: z.array(z.string()),
  }),
})

export const awsCloudformationGetTemplateSummaryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/get-template-summary',
  body: GetTemplateSummarySchema,
  response: { mode: 'json', schema: GetTemplateSummaryResponseSchema },
})
export type AwsCloudformationGetTemplateSummaryRequest = ContractBodyInput<
  typeof awsCloudformationGetTemplateSummaryContract
>
export type AwsCloudformationGetTemplateSummaryBody = ContractBody<
  typeof awsCloudformationGetTemplateSummaryContract
>
export type AwsCloudformationGetTemplateSummaryResponse = ContractJsonResponse<
  typeof awsCloudformationGetTemplateSummaryContract
>

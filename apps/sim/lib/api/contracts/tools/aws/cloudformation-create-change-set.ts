import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const CreateChangeSetSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    stackName: z.string().min(1, 'Stack name is required'),
    changeSetName: z.string().min(1, 'Change set name is required'),
    templateBody: z.string().optional(),
    usePreviousTemplate: z.boolean().optional(),
    parameters: z
      .array(
        z.object({
          parameterKey: z.string().min(1, 'Parameter key is required'),
          parameterValue: z.string().optional(),
          usePreviousValue: z.boolean().optional(),
        })
      )
      .optional(),
    capabilities: z
      .string()
      .optional()
      .refine(
        (v) =>
          !v ||
          v
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
            .every((c) =>
              ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'].includes(c)
            ),
        {
          message:
            'capabilities must be a comma-separated list of CAPABILITY_IAM, CAPABILITY_NAMED_IAM, CAPABILITY_AUTO_EXPAND',
        }
      ),
    changeSetType: z.enum(['CREATE', 'UPDATE', 'IMPORT']).optional(),
    description: z.string().max(1024, 'Description must be at most 1024 characters').optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.templateBody && !data.usePreviousTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either templateBody must be provided or usePreviousTemplate must be true',
        path: ['templateBody'],
      })
    }
  })

const CreateChangeSetResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    changeSetId: z.string(),
    stackId: z.string(),
  }),
})

export const awsCloudformationCreateChangeSetContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/create-change-set',
  body: CreateChangeSetSchema,
  response: { mode: 'json', schema: CreateChangeSetResponseSchema },
})
export type AwsCloudformationCreateChangeSetRequest = ContractBodyInput<
  typeof awsCloudformationCreateChangeSetContract
>
export type AwsCloudformationCreateChangeSetBody = ContractBody<
  typeof awsCloudformationCreateChangeSetContract
>
export type AwsCloudformationCreateChangeSetResponse = ContractJsonResponse<
  typeof awsCloudformationCreateChangeSetContract
>

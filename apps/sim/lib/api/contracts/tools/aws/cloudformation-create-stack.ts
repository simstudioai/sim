import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const CreateStackSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
  templateBody: z.string().min(1, 'Template body is required'),
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
    .optional(),
  onFailure: z.enum(['ROLLBACK', 'DELETE', 'DO_NOTHING']).optional(),
  timeoutInMinutes: z.coerce.number().int().positive().optional(),
})

const CreateStackResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    stackId: z.string(),
  }),
})

export const awsCloudformationCreateStackContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/create-stack',
  body: CreateStackSchema,
  response: { mode: 'json', schema: CreateStackResponseSchema },
})
export type AwsCloudformationCreateStackRequest = ContractBodyInput<
  typeof awsCloudformationCreateStackContract
>
export type AwsCloudformationCreateStackBody = ContractBody<
  typeof awsCloudformationCreateStackContract
>
export type AwsCloudformationCreateStackResponse = ContractJsonResponse<
  typeof awsCloudformationCreateStackContract
>

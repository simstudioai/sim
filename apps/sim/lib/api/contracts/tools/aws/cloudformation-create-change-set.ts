import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateChangeSetSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
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

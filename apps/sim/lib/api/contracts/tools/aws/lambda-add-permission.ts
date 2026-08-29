import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const AddPermissionSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  statementId: z
    .string()
    .min(1, 'statementId is required')
    .max(100, 'statementId cannot exceed 100 characters')
    .regex(
      /^[a-zA-Z0-9-_]+$/,
      'statementId may only contain letters, numbers, hyphens, and underscores'
    ),
  action: z
    .string()
    .min(1, 'action is required')
    .regex(
      /^(lambda:[*]|lambda:[a-zA-Z]+|[*])$/,
      'action must be a Lambda action such as lambda:InvokeFunction'
    ),
  principal: z.string().min(1, 'principal is required'),
  sourceArn: z.string().min(1, 'sourceArn cannot be empty').optional(),
  sourceAccount: z.string().min(1, 'sourceAccount cannot be empty').optional(),
  principalOrgId: z.string().min(1, 'principalOrgId cannot be empty').optional(),
  eventSourceToken: z.string().min(1, 'eventSourceToken cannot be empty').optional(),
  functionUrlAuthType: z.enum(['NONE', 'AWS_IAM']).optional(),
  qualifier: z
    .string()
    .min(1, 'qualifier cannot be empty')
    .max(128, 'qualifier cannot exceed 128 characters')
    .optional(),
  revisionId: z.string().min(1, 'revisionId cannot be empty').optional(),
})

const AddPermissionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    statement: z.string().nullable(),
  }),
})

export const awsLambdaAddPermissionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/add-permission',
  body: AddPermissionSchema,
  response: { mode: 'json', schema: AddPermissionResponseSchema },
})
export type AwsLambdaAddPermissionRequest = ContractBodyInput<typeof awsLambdaAddPermissionContract>
export type AwsLambdaAddPermissionBody = ContractBody<typeof awsLambdaAddPermissionContract>
export type AwsLambdaAddPermissionResponse = ContractJsonResponse<
  typeof awsLambdaAddPermissionContract
>

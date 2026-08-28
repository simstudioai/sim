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
  functionName: z.string().min(1, 'functionName is required'),
  statementId: z.string().min(1, 'statementId is required'),
  action: z.string().min(1, 'action is required'),
  principal: z.string().min(1, 'principal is required'),
  sourceArn: z.string().optional(),
  sourceAccount: z.string().optional(),
  principalOrgId: z.string().optional(),
  eventSourceToken: z.string().optional(),
  functionUrlAuthType: z.enum(['NONE', 'AWS_IAM']).optional(),
  qualifier: z.string().optional(),
  revisionId: z.string().optional(),
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

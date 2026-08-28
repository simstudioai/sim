import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaMessageResponseSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const RemovePermissionSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  statementId: z.string().min(1, 'statementId is required'),
  qualifier: z.string().optional(),
  revisionId: z.string().optional(),
})

const RemovePermissionResponseSchema = lambdaMessageResponseSchema

export const awsLambdaRemovePermissionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/remove-permission',
  body: RemovePermissionSchema,
  response: { mode: 'json', schema: RemovePermissionResponseSchema },
})
export type AwsLambdaRemovePermissionRequest = ContractBodyInput<
  typeof awsLambdaRemovePermissionContract
>
export type AwsLambdaRemovePermissionBody = ContractBody<typeof awsLambdaRemovePermissionContract>
export type AwsLambdaRemovePermissionResponse = ContractJsonResponse<
  typeof awsLambdaRemovePermissionContract
>

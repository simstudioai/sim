import { z } from 'zod'
import { iamConnectionShape, iamUserName128Schema } from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  userName: iamUserName128Schema.optional().nullable(),
})

const GetUserResponseSchema = z.object({
  userName: z.string(),
  userId: z.string(),
  arn: z.string(),
  path: z.string(),
  createDate: z.string().nullable(),
  passwordLastUsed: z.string().nullable(),
  permissionsBoundaryArn: z.string().nullable(),
  tags: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
})

export const awsIamGetUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/get-user',
  body: Schema,
  response: { mode: 'json', schema: GetUserResponseSchema },
})
export type AwsIamGetUserRequest = ContractBodyInput<typeof awsIamGetUserContract>
export type AwsIamGetUserBody = ContractBody<typeof awsIamGetUserContract>
export type AwsIamGetUserResponse = ContractJsonResponse<typeof awsIamGetUserContract>

import { z } from 'zod'
import {
  iamConnectionShape,
  iamCreatePathSchema,
  iamUserName64Schema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  userName: iamUserName64Schema,
  path: iamCreatePathSchema.optional().nullable(),
})

const CreateUserResponseSchema = z.object({
  message: z.string(),
  userName: z.string(),
  userId: z.string(),
  arn: z.string(),
  path: z.string(),
  createDate: z.string().nullable(),
})

export const awsIamCreateUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/create-user',
  body: Schema,
  response: { mode: 'json', schema: CreateUserResponseSchema },
})
export type AwsIamCreateUserRequest = ContractBodyInput<typeof awsIamCreateUserContract>
export type AwsIamCreateUserBody = ContractBody<typeof awsIamCreateUserContract>
export type AwsIamCreateUserResponse = ContractJsonResponse<typeof awsIamCreateUserContract>

import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import {
  iamConnectionShape,
  iamCreatePathSchema,
  iamPolicyArnSchema,
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
  permissionsBoundary: iamPolicyArnSchema.optional().nullable(),
  tags: z
    .string()
    .refine(
      (value) => {
        try {
          const parsed: unknown = JSON.parse(value)
          return (
            isRecordLike(parsed) &&
            Object.keys(parsed).length <= 50 &&
            Object.values(parsed).every((tagValue) =>
              ['string', 'number', 'boolean'].includes(typeof tagValue)
            )
          )
        } catch {
          return false
        }
      },
      { message: 'Tags must be a JSON object of at most 50 key/value pairs with scalar values' }
    )
    .optional()
    .nullable(),
})

const CreateUserResponseSchema = z.object({
  message: z.string(),
  userName: z.string(),
  userId: z.string(),
  arn: z.string(),
  path: z.string(),
  createDate: z.string().nullable(),
  permissionsBoundaryArn: z.string().nullable(),
  tags: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
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

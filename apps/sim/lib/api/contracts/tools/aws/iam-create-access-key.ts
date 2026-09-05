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

const CreateAccessKeyResponseSchema = z.object({
  message: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  userName: z.string(),
  status: z.string(),
  createDate: z.string().nullable(),
})

export const awsIamCreateAccessKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/create-access-key',
  body: Schema,
  response: { mode: 'json', schema: CreateAccessKeyResponseSchema },
})
export type AwsIamCreateAccessKeyRequest = ContractBodyInput<typeof awsIamCreateAccessKeyContract>
export type AwsIamCreateAccessKeyBody = ContractBody<typeof awsIamCreateAccessKeyContract>
export type AwsIamCreateAccessKeyResponse = ContractJsonResponse<
  typeof awsIamCreateAccessKeyContract
>

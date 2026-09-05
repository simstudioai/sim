import { z } from 'zod'
import {
  iamAccessKeyIdentifierSchema,
  iamAccessKeyStatusSchema,
  iamConnectionShape,
  iamUserName128Schema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  accessKeyIdToUpdate: iamAccessKeyIdentifierSchema,
  status: iamAccessKeyStatusSchema,
  userName: iamUserName128Schema.optional().nullable(),
})

export const awsIamUpdateAccessKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/update-access-key',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamUpdateAccessKeyRequest = ContractBodyInput<typeof awsIamUpdateAccessKeyContract>
export type AwsIamUpdateAccessKeyBody = ContractBody<typeof awsIamUpdateAccessKeyContract>
export type AwsIamUpdateAccessKeyResponse = ContractJsonResponse<
  typeof awsIamUpdateAccessKeyContract
>

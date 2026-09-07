import { z } from 'zod'
import {
  iamAccessKeyIdentifierSchema,
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
  accessKeyIdToDelete: iamAccessKeyIdentifierSchema,
  userName: iamUserName128Schema.optional().nullable(),
})

export const awsIamDeleteAccessKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/delete-access-key',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamDeleteAccessKeyRequest = ContractBodyInput<typeof awsIamDeleteAccessKeyContract>
export type AwsIamDeleteAccessKeyBody = ContractBody<typeof awsIamDeleteAccessKeyContract>
export type AwsIamDeleteAccessKeyResponse = ContractJsonResponse<
  typeof awsIamDeleteAccessKeyContract
>

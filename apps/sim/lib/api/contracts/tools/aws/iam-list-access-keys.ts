import { z } from 'zod'
import {
  iamConnectionShape,
  iamMarkerSchema,
  iamMaxItemsSchema,
  iamPaginationResponseShape,
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
  userName: iamUserName128Schema.optional().nullable(),
  maxItems: iamMaxItemsSchema.optional().nullable(),
  marker: iamMarkerSchema.optional().nullable(),
})

/**
 * The secret access key is never returned by ListAccessKeys; only the key's metadata is.
 */
const ListAccessKeysResponseSchema = z.object({
  accessKeys: z.array(
    z.object({
      accessKeyId: z.string(),
      userName: z.string(),
      status: z.string(),
      createDate: z.string().nullable(),
    })
  ),
  ...iamPaginationResponseShape,
})

export const awsIamListAccessKeysContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-access-keys',
  body: Schema,
  response: { mode: 'json', schema: ListAccessKeysResponseSchema },
})
export type AwsIamListAccessKeysRequest = ContractBodyInput<typeof awsIamListAccessKeysContract>
export type AwsIamListAccessKeysBody = ContractBody<typeof awsIamListAccessKeysContract>
export type AwsIamListAccessKeysResponse = ContractJsonResponse<typeof awsIamListAccessKeysContract>

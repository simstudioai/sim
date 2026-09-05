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
  userName: iamUserName128Schema,
})

export const awsIamDeleteUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/delete-user',
  body: Schema,
  response: { mode: 'json', schema: z.object({ message: z.string() }) },
})
export type AwsIamDeleteUserRequest = ContractBodyInput<typeof awsIamDeleteUserContract>
export type AwsIamDeleteUserBody = ContractBody<typeof awsIamDeleteUserContract>
export type AwsIamDeleteUserResponse = ContractJsonResponse<typeof awsIamDeleteUserContract>

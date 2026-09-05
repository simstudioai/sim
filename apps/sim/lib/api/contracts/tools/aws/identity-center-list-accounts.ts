import { z } from 'zod'
import {
  identityCenterAccountsMaxResultsSchema,
  identityCenterConnectionShape,
  identityCenterNextTokenSchema,
} from '@/lib/api/contracts/tools/aws/identity-center-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...identityCenterConnectionShape,
  maxResults: identityCenterAccountsMaxResultsSchema.optional(),
  nextToken: identityCenterNextTokenSchema.optional(),
})

const ResponseSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string(),
      arn: z.string(),
      name: z.string(),
      email: z.string(),
      status: z.string(),
      joinedTimestamp: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListAccountsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-accounts',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListAccountsRequest = ContractBodyInput<
  typeof awsIdentityCenterListAccountsContract
>
export type AwsIdentityCenterListAccountsBody = ContractBody<
  typeof awsIdentityCenterListAccountsContract
>
export type AwsIdentityCenterListAccountsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListAccountsContract
>

import { z } from 'zod'
import {
  identityCenterConnectionShape,
  identityCenterMaxResultsSchema,
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
  maxResults: identityCenterMaxResultsSchema.optional(),
  nextToken: identityCenterNextTokenSchema.optional(),
})

const ResponseSchema = z.object({
  instances: z.array(
    z.object({
      instanceArn: z.string(),
      identityStoreId: z.string(),
      name: z.string().nullable(),
      status: z.string(),
      statusReason: z.string().nullable(),
      ownerAccountId: z.string().nullable(),
      createdDate: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListInstancesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-instances',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListInstancesRequest = ContractBodyInput<
  typeof awsIdentityCenterListInstancesContract
>
export type AwsIdentityCenterListInstancesBody = ContractBody<
  typeof awsIdentityCenterListInstancesContract
>
export type AwsIdentityCenterListInstancesResponse = ContractJsonResponse<
  typeof awsIdentityCenterListInstancesContract
>

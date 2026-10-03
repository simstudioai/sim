import { z } from 'zod'
import {
  identityCenterAccountIdSchema,
  identityCenterConnectionShape,
} from '@/lib/api/contracts/tools/aws/identity-center-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...identityCenterConnectionShape,
  accountId: identityCenterAccountIdSchema,
})

const ResponseSchema = z.object({
  id: z.string(),
  arn: z.string(),
  name: z.string(),
  email: z.string(),
  status: z.string(),
  joinedTimestamp: z.string().nullable(),
})

export const awsIdentityCenterDescribeAccountContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/describe-account',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterDescribeAccountRequest = ContractBodyInput<
  typeof awsIdentityCenterDescribeAccountContract
>
export type AwsIdentityCenterDescribeAccountBody = ContractBody<
  typeof awsIdentityCenterDescribeAccountContract
>
export type AwsIdentityCenterDescribeAccountResponse = ContractJsonResponse<
  typeof awsIdentityCenterDescribeAccountContract
>

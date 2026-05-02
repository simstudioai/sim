import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListIdentitiesSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  pageSize: z.number().int().min(0).max(1000).nullish(),
  nextToken: z.string().nullish(),
})

const ListIdentitiesResponseSchema = z.object({
  identities: z.array(
    z.object({
      identityName: z.string(),
      identityType: z.string(),
      sendingEnabled: z.boolean(),
      verificationStatus: z.string(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSesListIdentitiesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/list-identities',
  body: ListIdentitiesSchema,
  response: { mode: 'json', schema: ListIdentitiesResponseSchema },
})
export type AwsSesListIdentitiesRequest = ContractBodyInput<typeof awsSesListIdentitiesContract>
export type AwsSesListIdentitiesBody = ContractBody<typeof awsSesListIdentitiesContract>
export type AwsSesListIdentitiesResponse = ContractJsonResponse<typeof awsSesListIdentitiesContract>

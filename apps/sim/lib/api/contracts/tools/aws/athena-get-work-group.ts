import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaEngineVersionSchema,
  athenaWorkGroupSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetWorkGroupSchema = athenaConnectionSchema.extend({
  workGroup: athenaWorkGroupSchema,
})

const GetWorkGroupResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    name: z.string(),
    state: z.string().nullable(),
    description: z.string().nullable(),
    creationTime: z.number().nullable(),
    identityCenterApplicationArn: z.string().nullable(),
    engineVersion: athenaEngineVersionSchema.nullable(),
    outputLocation: z.string().nullable(),
    encryptionOption: z.string().nullable(),
    kmsKey: z.string().nullable(),
    expectedBucketOwner: z.string().nullable(),
    managedQueryResultsEnabled: z.boolean().nullable(),
    enforceWorkGroupConfiguration: z.boolean().nullable(),
    publishCloudWatchMetricsEnabled: z.boolean().nullable(),
    bytesScannedCutoffPerQuery: z.number().nullable(),
    requesterPaysEnabled: z.boolean().nullable(),
    enableMinimumEncryptionConfiguration: z.boolean().nullable(),
    executionRole: z.string().nullable(),
  }),
})

export const awsAthenaGetWorkGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-work-group',
  body: GetWorkGroupSchema,
  response: { mode: 'json', schema: GetWorkGroupResponseSchema },
})
export type AwsAthenaGetWorkGroupRequest = ContractBodyInput<typeof awsAthenaGetWorkGroupContract>
export type AwsAthenaGetWorkGroupBody = ContractBody<typeof awsAthenaGetWorkGroupContract>
export type AwsAthenaGetWorkGroupResponse = ContractJsonResponse<
  typeof awsAthenaGetWorkGroupContract
>

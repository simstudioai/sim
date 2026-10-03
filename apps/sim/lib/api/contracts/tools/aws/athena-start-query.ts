import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaOptionalWorkGroupSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const StartQuerySchema = athenaConnectionSchema.extend({
  queryString: z.string().min(1, 'Query string is required'),
  database: z.string().optional(),
  catalog: z.string().optional(),
  outputLocation: z.string().optional(),
  workGroup: athenaOptionalWorkGroupSchema,
  executionParameters: z
    .array(z.string().min(1, 'Execution parameters cannot be empty').max(1024))
    .min(1, 'At least one execution parameter is required when provided')
    .optional(),
  resultReuseEnabled: z.boolean().optional(),
  resultReuseMaxAgeInMinutes: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(0).max(10080).optional()
  ),
})

const StartQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryExecutionId: z.string(),
  }),
})

export const awsAthenaStartQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/start-query',
  body: StartQuerySchema,
  response: { mode: 'json', schema: StartQueryResponseSchema },
})
export type AwsAthenaStartQueryRequest = ContractBodyInput<typeof awsAthenaStartQueryContract>
export type AwsAthenaStartQueryBody = ContractBody<typeof awsAthenaStartQueryContract>
export type AwsAthenaStartQueryResponse = ContractJsonResponse<typeof awsAthenaStartQueryContract>

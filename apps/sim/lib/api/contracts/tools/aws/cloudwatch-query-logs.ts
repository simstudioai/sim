import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const QueryLogsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  logGroupNames: z.array(z.string().min(1)).min(1, 'At least one log group name is required'),
  queryString: z.string().min(1, 'Query string is required'),
  startTime: z.coerce.number().int(),
  endTime: z.coerce.number().int(),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
})

export const awsCloudwatchQueryLogsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/query-logs',
  body: QueryLogsSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsCloudwatchQueryLogsRequest = ContractBodyInput<typeof awsCloudwatchQueryLogsContract>
export type AwsCloudwatchQueryLogsBody = ContractBody<typeof awsCloudwatchQueryLogsContract>
export type AwsCloudwatchQueryLogsResponse = ContractJsonResponse<
  typeof awsCloudwatchQueryLogsContract
>

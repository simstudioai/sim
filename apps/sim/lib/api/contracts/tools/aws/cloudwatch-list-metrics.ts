import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListMetricsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  namespace: z.string().optional(),
  metricName: z.string().optional(),
  recentlyActive: z.boolean().optional(),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
})

const ListMetricsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    metrics: z.array(
      z.object({
        namespace: z.string(),
        metricName: z.string(),
        dimensions: z.array(
          z.object({
            name: z.string(),
            value: z.string(),
          })
        ),
      })
    ),
  }),
})

export const awsCloudwatchListMetricsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/list-metrics',
  body: ListMetricsSchema,
  response: { mode: 'json', schema: ListMetricsResponseSchema },
})
export type AwsCloudwatchListMetricsRequest = ContractBodyInput<
  typeof awsCloudwatchListMetricsContract
>
export type AwsCloudwatchListMetricsBody = ContractBody<typeof awsCloudwatchListMetricsContract>
export type AwsCloudwatchListMetricsResponse = ContractJsonResponse<
  typeof awsCloudwatchListMetricsContract
>

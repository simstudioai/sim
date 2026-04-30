import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetMetricStatisticsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  namespace: z.string().min(1, 'Namespace is required'),
  metricName: z.string().min(1, 'Metric name is required'),
  startTime: z.coerce.number().int(),
  endTime: z.coerce.number().int(),
  period: z.coerce.number().int().min(1),
  statistics: z.array(z.enum(['Average', 'Sum', 'Minimum', 'Maximum', 'SampleCount'])).min(1),
  dimensions: z.string().optional(),
})

const GetMetricStatisticsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    label: z.string(),
    datapoints: z.array(
      z.object({
        timestamp: z.number(),
        average: z.number().optional(),
        sum: z.number().optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        sampleCount: z.number().optional(),
        unit: z.string().optional(),
      })
    ),
  }),
})

export const awsCloudwatchGetMetricStatisticsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/get-metric-statistics',
  body: GetMetricStatisticsSchema,
  response: { mode: 'json', schema: GetMetricStatisticsResponseSchema },
})
export type AwsCloudwatchGetMetricStatisticsRequest = ContractBodyInput<
  typeof awsCloudwatchGetMetricStatisticsContract
>
export type AwsCloudwatchGetMetricStatisticsBody = ContractBody<
  typeof awsCloudwatchGetMetricStatisticsContract
>
export type AwsCloudwatchGetMetricStatisticsResponse = ContractJsonResponse<
  typeof awsCloudwatchGetMetricStatisticsContract
>

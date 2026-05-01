import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const VALID_UNITS = [
  'Seconds',
  'Microseconds',
  'Milliseconds',
  'Bytes',
  'Kilobytes',
  'Megabytes',
  'Gigabytes',
  'Terabytes',
  'Bits',
  'Kilobits',
  'Megabits',
  'Gigabits',
  'Terabits',
  'Percent',
  'Count',
  'Bytes/Second',
  'Kilobytes/Second',
  'Megabytes/Second',
  'Gigabytes/Second',
  'Terabytes/Second',
  'Bits/Second',
  'Kilobits/Second',
  'Megabits/Second',
  'Gigabits/Second',
  'Terabits/Second',
  'Count/Second',
  'None',
] as const

const PutMetricDataSchema = z.object({
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
  value: z.coerce.number().refine((v) => Number.isFinite(v), {
    message: 'Metric value must be a finite number',
  }),
  unit: z.enum(VALID_UNITS).optional(),
  dimensions: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true
        try {
          const parsed = JSON.parse(val)
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        } catch {
          return false
        }
      },
      { message: 'dimensions must be a valid JSON object string' }
    ),
})

const PutMetricDataResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    success: z.literal(true),
    namespace: z.string(),
    metricName: z.string(),
    value: z.number(),
    unit: z.string(),
    timestamp: z.string(),
  }),
})

export const awsCloudwatchPutMetricDataContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/put-metric-data',
  body: PutMetricDataSchema,
  response: { mode: 'json', schema: PutMetricDataResponseSchema },
})
export type AwsCloudwatchPutMetricDataRequest = ContractBodyInput<
  typeof awsCloudwatchPutMetricDataContract
>
export type AwsCloudwatchPutMetricDataBody = ContractBody<typeof awsCloudwatchPutMetricDataContract>
export type AwsCloudwatchPutMetricDataResponse = ContractJsonResponse<
  typeof awsCloudwatchPutMetricDataContract
>

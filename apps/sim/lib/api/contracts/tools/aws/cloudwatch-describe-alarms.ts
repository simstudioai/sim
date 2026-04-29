import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DescribeAlarmsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  alarmNamePrefix: z.string().optional(),
  stateValue: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['OK', 'ALARM', 'INSUFFICIENT_DATA']).optional()
  ),
  alarmType: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['MetricAlarm', 'CompositeAlarm']).optional()
  ),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
})

export const awsCloudwatchDescribeAlarmsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/describe-alarms',
  body: DescribeAlarmsSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsCloudwatchDescribeAlarmsRequest = ContractBodyInput<
  typeof awsCloudwatchDescribeAlarmsContract
>
export type AwsCloudwatchDescribeAlarmsBody = ContractBody<
  typeof awsCloudwatchDescribeAlarmsContract
>
export type AwsCloudwatchDescribeAlarmsResponse = ContractJsonResponse<
  typeof awsCloudwatchDescribeAlarmsContract
>

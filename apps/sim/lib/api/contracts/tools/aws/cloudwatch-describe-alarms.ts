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
    z.coerce
      .number()
      .int()
      .positive()
      .max(100, 'limit must be at most 100 (CloudWatch DescribeAlarms limit)')
      .optional()
  ),
  nextToken: z.string().optional(),
})

const DescribeAlarmsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    alarms: z.array(
      z.object({
        alarmName: z.string(),
        alarmArn: z.string(),
        stateValue: z.string(),
        stateReason: z.string(),
        metricName: z.string().optional(),
        namespace: z.string().optional(),
        comparisonOperator: z.string().optional(),
        threshold: z.number().optional(),
        evaluationPeriods: z.number().optional(),
        stateUpdatedTimestamp: z.number().optional(),
        alarmType: z.string(),
        alarmDescription: z.string().optional(),
        actionsEnabled: z.boolean().optional(),
        alarmActions: z.array(z.string()),
        okActions: z.array(z.string()),
        insufficientDataActions: z.array(z.string()),
        stateReasonData: z.string().optional(),
        stateTransitionedTimestamp: z.number().optional(),
        alarmConfigurationUpdatedTimestamp: z.number().optional(),
        statistic: z.string().optional(),
        extendedStatistic: z.string().optional(),
        dimensions: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
        period: z.number().optional(),
        unit: z.string().optional(),
        datapointsToAlarm: z.number().optional(),
        treatMissingData: z.string().optional(),
        thresholdMetricId: z.string().optional(),
        metrics: z
          .array(
            z.object({
              id: z.string(),
              expression: z.string().optional(),
              label: z.string().optional(),
              returnData: z.boolean().optional(),
              period: z.number().optional(),
              accountId: z.string().optional(),
              metricStat: z
                .object({
                  namespace: z.string().optional(),
                  metricName: z.string().optional(),
                  dimensions: z.array(z.object({ name: z.string(), value: z.string() })),
                  period: z.number().optional(),
                  stat: z.string().optional(),
                  unit: z.string().optional(),
                })
                .optional(),
            })
          )
          .optional(),
        alarmRule: z.string().optional(),
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsCloudwatchDescribeAlarmsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/describe-alarms',
  body: DescribeAlarmsSchema,
  response: { mode: 'json', schema: DescribeAlarmsResponseSchema },
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

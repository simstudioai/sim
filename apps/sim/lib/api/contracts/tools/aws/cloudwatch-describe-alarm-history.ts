import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DescribeAlarmHistorySchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  alarmName: z.string().optional(),
  historyItemType: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .enum([
        'ConfigurationUpdate',
        'StateUpdate',
        'Action',
        'AlarmContributorStateUpdate',
        'AlarmContributorAction',
      ])
      .optional()
  ),
  startDate: z.coerce.number().int().optional(),
  endDate: z.coerce.number().int().optional(),
  scanBy: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['TimestampDescending', 'TimestampAscending']).optional()
  ),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
})

const DescribeAlarmHistoryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    alarmHistoryItems: z.array(
      z.object({
        alarmName: z.string().optional(),
        alarmType: z.string().optional(),
        timestamp: z.number().optional(),
        historyItemType: z.string().optional(),
        historySummary: z.string().optional(),
      })
    ),
  }),
})

export const awsCloudwatchDescribeAlarmHistoryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/describe-alarm-history',
  body: DescribeAlarmHistorySchema,
  response: { mode: 'json', schema: DescribeAlarmHistoryResponseSchema },
})
export type AwsCloudwatchDescribeAlarmHistoryRequest = ContractBodyInput<
  typeof awsCloudwatchDescribeAlarmHistoryContract
>
export type AwsCloudwatchDescribeAlarmHistoryBody = ContractBody<
  typeof awsCloudwatchDescribeAlarmHistoryContract
>
export type AwsCloudwatchDescribeAlarmHistoryResponse = ContractJsonResponse<
  typeof awsCloudwatchDescribeAlarmHistoryContract
>

import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const MAX_MUTE_MINUTES = 15 * 24 * 60

const MuteAlarmSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    muteRuleName: z
      .string()
      .min(1, 'muteRuleName cannot be empty')
      .max(255, 'muteRuleName must be at most 255 characters'),
    alarmNames: z
      .array(z.string().min(1, 'Alarm name cannot be empty').max(255))
      .min(1, 'At least one alarm name is required')
      .max(100, 'At most 100 alarm names are allowed per mute rule'),
    durationValue: z
      .number()
      .int('durationValue must be an integer')
      .min(1, 'durationValue must be at least 1'),
    durationUnit: z.enum(['minutes', 'hours', 'days']),
    description: z.string().max(1024).optional(),
    startDate: z
      .number()
      .int('startDate must be an integer')
      .min(0, 'startDate must be a non-negative Unix epoch in seconds')
      .optional(),
  })
  .superRefine((data, ctx) => {
    const minutesPerUnit = { minutes: 1, hours: 60, days: 1440 } as const
    const totalMinutes = data.durationValue * minutesPerUnit[data.durationUnit]
    if (totalMinutes > MAX_MUTE_MINUTES) {
      ctx.addIssue({
        code: 'custom',
        message: 'duration must be at most 15 days (CloudWatch mute rule limit)',
        path: ['durationValue'],
      })
    }
  })

const MuteAlarmResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    success: z.literal(true),
    muteRuleName: z.string(),
    alarmNames: z.array(z.string()),
    expression: z.string(),
    duration: z.string(),
  }),
})

export const awsCloudwatchMuteAlarmContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/mute-alarm',
  body: MuteAlarmSchema,
  response: { mode: 'json', schema: MuteAlarmResponseSchema },
})
export type AwsCloudwatchMuteAlarmRequest = ContractBodyInput<typeof awsCloudwatchMuteAlarmContract>
export type AwsCloudwatchMuteAlarmBody = ContractBody<typeof awsCloudwatchMuteAlarmContract>
export type AwsCloudwatchMuteAlarmResponse = ContractJsonResponse<
  typeof awsCloudwatchMuteAlarmContract
>

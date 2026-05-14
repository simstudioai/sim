import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const MuteAlarmSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  alarmNames: z
    .array(z.string().min(1, 'Alarm name cannot be empty'))
    .min(1, 'At least one alarm name is required')
    .max(100, 'At most 100 alarm names are allowed per request'),
})

const MuteAlarmResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    success: z.literal(true),
    alarmNames: z.array(z.string()),
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

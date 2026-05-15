import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const UnmuteAlarmSchema = z.object({
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
})

const UnmuteAlarmResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    success: z.literal(true),
    muteRuleName: z.string(),
  }),
})

export const awsCloudwatchUnmuteAlarmContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/unmute-alarm',
  body: UnmuteAlarmSchema,
  response: { mode: 'json', schema: UnmuteAlarmResponseSchema },
})
export type AwsCloudwatchUnmuteAlarmRequest = ContractBodyInput<
  typeof awsCloudwatchUnmuteAlarmContract
>
export type AwsCloudwatchUnmuteAlarmBody = ContractBody<typeof awsCloudwatchUnmuteAlarmContract>
export type AwsCloudwatchUnmuteAlarmResponse = ContractJsonResponse<
  typeof awsCloudwatchUnmuteAlarmContract
>

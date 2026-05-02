import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const SendMessageSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queueUrl: z.string().min(1, 'Queue URL is required'),
  messageGroupId: z.string().nullish(),
  messageDeduplicationId: z.string().nullish(),
  data: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'Data object must have at least one field',
  }),
})

const SendMessageResponseSchema = z.object({
  message: z.string(),
  id: z.string().optional(),
})

export const awsSqsSendContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/send',
  body: SendMessageSchema,
  response: { mode: 'json', schema: SendMessageResponseSchema },
})
export type AwsSqsSendRequest = ContractBodyInput<typeof awsSqsSendContract>
export type AwsSqsSendBody = ContractBody<typeof awsSqsSendContract>
export type AwsSqsSendResponse = ContractJsonResponse<typeof awsSqsSendContract>

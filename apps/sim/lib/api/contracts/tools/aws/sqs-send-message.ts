import { z } from 'zod'
import {
  sqsConnectionFields,
  sqsMessageAttributesInputSchema,
  sqsMessageDeduplicationIdField,
  sqsMessageGroupIdField,
  sqsQueueUrlField,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const SendMessageSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  data: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: 'Data object must have at least one field',
  }),
  delaySeconds: z
    .number()
    .int()
    .min(0, 'delaySeconds must be at least 0')
    .max(900, 'delaySeconds cannot exceed 900')
    .nullish(),
  messageAttributes: sqsMessageAttributesInputSchema.nullish(),
  messageGroupId: sqsMessageGroupIdField.nullish(),
  messageDeduplicationId: sqsMessageDeduplicationIdField.nullish(),
})

const SendMessageResponseSchema = z.object({
  message: z.string(),
  id: z.string().nullable(),
  md5OfMessageBody: z.string().nullable(),
  md5OfMessageAttributes: z.string().nullable(),
  sequenceNumber: z.string().nullable(),
})

export const awsSqsSendMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/send-message',
  body: SendMessageSchema,
  response: { mode: 'json', schema: SendMessageResponseSchema },
})
export type AwsSqsSendMessageRequest = ContractBodyInput<typeof awsSqsSendMessageContract>
export type AwsSqsSendMessageBody = ContractBody<typeof awsSqsSendMessageContract>
export type AwsSqsSendMessageResponse = ContractJsonResponse<typeof awsSqsSendMessageContract>

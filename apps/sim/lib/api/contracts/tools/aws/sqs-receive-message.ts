import { z } from 'zod'
import {
  sqsConnectionFields,
  sqsMessageAttributesOutputSchema,
  sqsMessageSystemAttributeNameSchema,
  sqsQueueUrlField,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ReceiveMessageSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  maxNumberOfMessages: z
    .number()
    .int()
    .min(1, 'maxNumberOfMessages must be at least 1')
    .max(10, 'maxNumberOfMessages cannot exceed 10')
    .nullish(),
  visibilityTimeout: z
    .number()
    .int()
    .min(0, 'visibilityTimeout must be at least 0')
    .max(43200, 'visibilityTimeout cannot exceed 43200 seconds (12 hours)')
    .nullish(),
  waitTimeSeconds: z
    .number()
    .int()
    .min(0, 'waitTimeSeconds must be at least 0')
    .max(20, 'waitTimeSeconds cannot exceed 20')
    .nullish(),
  messageAttributeNames: z
    .array(z.string().min(1, 'Message attribute name cannot be empty'))
    .nullish(),
  messageSystemAttributeNames: z.array(sqsMessageSystemAttributeNameSchema).nullish(),
  receiveRequestAttemptId: z
    .string()
    .max(128, 'receiveRequestAttemptId must be at most 128 characters')
    .nullish(),
})

const ReceiveMessageResponseSchema = z.object({
  messages: z.array(
    z.object({
      messageId: z.string().nullable(),
      receiptHandle: z.string().nullable(),
      body: z.string().nullable(),
      md5OfBody: z.string().nullable(),
      md5OfMessageAttributes: z.string().nullable(),
      attributes: z.record(z.string(), z.string()),
      messageAttributes: sqsMessageAttributesOutputSchema,
    })
  ),
  count: z.number(),
})

export const awsSqsReceiveMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/receive-message',
  body: ReceiveMessageSchema,
  response: { mode: 'json', schema: ReceiveMessageResponseSchema },
})
export type AwsSqsReceiveMessageRequest = ContractBodyInput<typeof awsSqsReceiveMessageContract>
export type AwsSqsReceiveMessageBody = ContractBody<typeof awsSqsReceiveMessageContract>
export type AwsSqsReceiveMessageResponse = ContractJsonResponse<typeof awsSqsReceiveMessageContract>

import { z } from 'zod'
import {
  defineCommunicationToolContract,
  slackBlocksSchema,
} from '@/lib/api/contracts/tools/communication/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

export const slackSendMessageBodySchema = z
  .object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().optional().nullable(),
    userId: z.string().optional().nullable(),
    text: z.string().min(1, 'Message text is required'),
    thread_ts: z.string().optional().nullable(),
    blocks: slackBlocksSchema.optional().nullable(),
    files: RawFileInputArraySchema.optional().nullable(),
  })
  .refine((data) => data.channel || data.userId, {
    message: 'Either channel or userId is required',
  })

export const slackReadMessagesBodySchema = z
  .object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().optional().nullable(),
    userId: z.string().optional().nullable(),
    limit: z.coerce
      .number()
      .min(1, 'Limit must be at least 1')
      .max(15, 'Limit cannot exceed 15')
      .optional()
      .nullable(),
    oldest: z.string().optional().nullable(),
    latest: z.string().optional().nullable(),
  })
  .refine((data) => data.channel || data.userId, {
    message: 'Either channel or userId is required',
  })

export const slackReactionBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel is required'),
  timestamp: z.string().min(1, 'Message timestamp is required'),
  name: z.string().min(1, 'Emoji name is required'),
})

export const slackDeleteMessageBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel is required'),
  timestamp: z.string().min(1, 'Message timestamp is required'),
})

export const slackUpdateMessageBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel is required'),
  timestamp: z.string().min(1, 'Message timestamp is required'),
  text: z.string().min(1, 'Message text is required'),
  blocks: slackBlocksSchema.optional().nullable(),
})

export const slackSendEphemeralBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel ID is required'),
  user: z.string().min(1, 'User ID is required'),
  text: z.string().min(1, 'Message text is required'),
  thread_ts: z.string().optional().nullable(),
  blocks: slackBlocksSchema.optional().nullable(),
})

export const slackDownloadBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileId: z.string().min(1, 'File ID is required'),
  fileName: z.string().optional().nullable(),
})

export const slackSendMessageContract = defineCommunicationToolContract(
  '/api/tools/slack/send-message',
  slackSendMessageBodySchema
)
export const slackReadMessagesContract = defineCommunicationToolContract(
  '/api/tools/slack/read-messages',
  slackReadMessagesBodySchema
)
export const slackAddReactionContract = defineCommunicationToolContract(
  '/api/tools/slack/add-reaction',
  slackReactionBodySchema
)
export const slackRemoveReactionContract = defineCommunicationToolContract(
  '/api/tools/slack/remove-reaction',
  slackReactionBodySchema
)
export const slackDeleteMessageContract = defineCommunicationToolContract(
  '/api/tools/slack/delete-message',
  slackDeleteMessageBodySchema
)
export const slackUpdateMessageContract = defineCommunicationToolContract(
  '/api/tools/slack/update-message',
  slackUpdateMessageBodySchema
)
export const slackSendEphemeralContract = defineCommunicationToolContract(
  '/api/tools/slack/send-ephemeral',
  slackSendEphemeralBodySchema
)
export const slackDownloadContract = defineCommunicationToolContract(
  '/api/tools/slack/download',
  slackDownloadBodySchema
)

export type SlackSendMessageBody = ContractBodyInput<typeof slackSendMessageContract>
export type SlackReadMessagesBody = ContractBodyInput<typeof slackReadMessagesContract>
export type SlackReactionBody = ContractBodyInput<typeof slackAddReactionContract>
export type SlackDeleteMessageBody = ContractBodyInput<typeof slackDeleteMessageContract>
export type SlackUpdateMessageBody = ContractBodyInput<typeof slackUpdateMessageContract>
export type SlackSendEphemeralBody = ContractBodyInput<typeof slackSendEphemeralContract>
export type SlackDownloadBody = ContractBodyInput<typeof slackDownloadContract>

export type SlackSendMessageResponse = ContractJsonResponse<typeof slackSendMessageContract>
export type SlackReadMessagesResponse = ContractJsonResponse<typeof slackReadMessagesContract>
export type SlackReactionResponse = ContractJsonResponse<typeof slackAddReactionContract>
export type SlackDeleteMessageResponse = ContractJsonResponse<typeof slackDeleteMessageContract>
export type SlackUpdateMessageResponse = ContractJsonResponse<typeof slackUpdateMessageContract>
export type SlackSendEphemeralResponse = ContractJsonResponse<typeof slackSendEphemeralContract>
export type SlackDownloadResponse = ContractJsonResponse<typeof slackDownloadContract>

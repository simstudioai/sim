import { z } from 'zod'
import {
  defineCommunicationToolContract,
  slackBlocksSchema,
} from '@/lib/api/contracts/tools/communication/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

const slackSendMessageBodySchema = z
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

const slackReadMessagesBodySchema = z
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

const slackReactionBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel is required'),
  timestamp: z.string().min(1, 'Message timestamp is required'),
  name: z.string().min(1, 'Emoji name is required'),
})

const slackDeleteMessageBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel is required'),
  timestamp: z.string().min(1, 'Message timestamp is required'),
})

const slackUpdateMessageBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel is required'),
  timestamp: z.string().min(1, 'Message timestamp is required'),
  text: z.string().min(1, 'Message text is required'),
  blocks: slackBlocksSchema.optional().nullable(),
})

const slackSendEphemeralBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel ID is required'),
  user: z.string().min(1, 'User ID is required'),
  text: z.string().min(1, 'Message text is required'),
  thread_ts: z.string().optional().nullable(),
  blocks: slackBlocksSchema.optional().nullable(),
})

const slackDownloadBodySchema = z.object({
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

type SlackSendMessageBody = ContractBodyInput<typeof slackSendMessageContract>
type SlackReadMessagesBody = ContractBodyInput<typeof slackReadMessagesContract>
type SlackReactionBody = ContractBodyInput<typeof slackAddReactionContract>
type SlackDeleteMessageBody = ContractBodyInput<typeof slackDeleteMessageContract>
type SlackUpdateMessageBody = ContractBodyInput<typeof slackUpdateMessageContract>
type SlackSendEphemeralBody = ContractBodyInput<typeof slackSendEphemeralContract>
type SlackDownloadBody = ContractBodyInput<typeof slackDownloadContract>

type SlackSendMessageResponse = ContractJsonResponse<typeof slackSendMessageContract>
type SlackReadMessagesResponse = ContractJsonResponse<typeof slackReadMessagesContract>
type SlackReactionResponse = ContractJsonResponse<typeof slackAddReactionContract>
type SlackDeleteMessageResponse = ContractJsonResponse<typeof slackDeleteMessageContract>
type SlackUpdateMessageResponse = ContractJsonResponse<typeof slackUpdateMessageContract>
type SlackSendEphemeralResponse = ContractJsonResponse<typeof slackSendEphemeralContract>
type SlackDownloadResponse = ContractJsonResponse<typeof slackDownloadContract>

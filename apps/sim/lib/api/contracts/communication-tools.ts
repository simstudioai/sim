import { z } from 'zod'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

const communicationToolResponseSchema = z.unknown()
const slackBlocksSchema = z.array(z.record(z.string(), z.unknown()))
const discordIdSchema = z.union([z.string(), z.number()])

const discordRequiredIdSchema = (message: string) =>
  z.preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    discordIdSchema.refine((value) => value !== '', { message })
  )

const discordBotTokenSelectorSchema = z.preprocess(
  (value) => (value === null || value === undefined ? '' : value),
  z.string().min(1, 'Bot token is required')
)

const defineCommunicationToolContract = <TBody extends z.ZodType>(path: string, body: TBody) =>
  defineRouteContract({
    method: 'POST',
    path,
    body,
    response: {
      mode: 'json',
      schema: communicationToolResponseSchema,
    },
  })

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

export const discordSendMessageBodySchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  channelId: z.string().min(1, 'Channel ID is required'),
  content: z.string().optional().nullable(),
  files: RawFileInputArraySchema.optional().nullable(),
})

export const discordChannelsBodySchema = z.object({
  botToken: discordBotTokenSelectorSchema,
  serverId: discordRequiredIdSchema('Server ID is required'),
  channelId: discordIdSchema.optional().nullable(),
})

export const discordServersBodySchema = z.object({
  botToken: discordBotTokenSelectorSchema,
  serverId: discordIdSchema.optional().nullable(),
})

export const smsSendBodySchema = z.object({
  to: z.string().min(1, 'To phone number is required'),
  body: z.string().min(1, 'SMS body is required'),
})

export const smtpSendBodySchema = z.object({
  smtpHost: z.string().min(1, 'SMTP host is required'),
  smtpPort: z.number().min(1).max(65535, 'Port must be between 1 and 65535'),
  smtpUsername: z.string().min(1, 'SMTP username is required'),
  smtpPassword: z.string().min(1, 'SMTP password is required'),
  smtpSecure: z.enum(['TLS', 'SSL', 'None']),
  from: z.string().email('Invalid from email address').min(1, 'From address is required'),
  to: z.string().min(1, 'To email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),
  fromName: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  replyTo: z.string().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

export const sendGridSendMailBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  from: z.string().min(1, 'From email is required'),
  fromName: z.string().optional().nullable(),
  to: z.string().min(1, 'To email is required'),
  toName: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  contentType: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  replyTo: z.string().optional().nullable(),
  replyToName: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
  dynamicTemplateData: z.unknown().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

export const telegramSendDocumentBodySchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  files: RawFileInputArraySchema.optional().nullable(),
  caption: z.string().optional().nullable(),
})

export const twilioGetRecordingBodySchema = z.object({
  accountSid: z.string().min(1, 'Account SID is required'),
  authToken: z.string().min(1, 'Auth token is required'),
  recordingSid: z.string().min(1, 'Recording SID is required'),
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
export const discordSendMessageContract = defineCommunicationToolContract(
  '/api/tools/discord/send-message',
  discordSendMessageBodySchema
)
export const discordChannelsContract = defineCommunicationToolContract(
  '/api/tools/discord/channels',
  discordChannelsBodySchema
)
export const discordServersContract = defineCommunicationToolContract(
  '/api/tools/discord/servers',
  discordServersBodySchema
)
export const smsSendContract = defineCommunicationToolContract(
  '/api/tools/sms/send',
  smsSendBodySchema
)
export const smtpSendContract = defineCommunicationToolContract(
  '/api/tools/smtp/send',
  smtpSendBodySchema
)
export const sendGridSendMailContract = defineCommunicationToolContract(
  '/api/tools/sendgrid/send-mail',
  sendGridSendMailBodySchema
)
export const telegramSendDocumentContract = defineCommunicationToolContract(
  '/api/tools/telegram/send-document',
  telegramSendDocumentBodySchema
)
export const twilioGetRecordingContract = defineCommunicationToolContract(
  '/api/tools/twilio/get-recording',
  twilioGetRecordingBodySchema
)

export type SlackSendMessageBody = ContractBodyInput<typeof slackSendMessageContract>
export type SlackReadMessagesBody = ContractBodyInput<typeof slackReadMessagesContract>
export type SlackReactionBody = ContractBodyInput<typeof slackAddReactionContract>
export type SlackDeleteMessageBody = ContractBodyInput<typeof slackDeleteMessageContract>
export type SlackUpdateMessageBody = ContractBodyInput<typeof slackUpdateMessageContract>
export type SlackSendEphemeralBody = ContractBodyInput<typeof slackSendEphemeralContract>
export type SlackDownloadBody = ContractBodyInput<typeof slackDownloadContract>
export type DiscordSendMessageBody = ContractBodyInput<typeof discordSendMessageContract>
export type DiscordChannelsBody = ContractBodyInput<typeof discordChannelsContract>
export type DiscordServersBody = ContractBodyInput<typeof discordServersContract>
export type SmsSendBody = ContractBodyInput<typeof smsSendContract>
export type SmtpSendBody = ContractBodyInput<typeof smtpSendContract>
export type SendGridSendMailBody = ContractBodyInput<typeof sendGridSendMailContract>
export type TelegramSendDocumentBody = ContractBodyInput<typeof telegramSendDocumentContract>
export type TwilioGetRecordingBody = ContractBodyInput<typeof twilioGetRecordingContract>

export type SlackSendMessageResponse = ContractJsonResponse<typeof slackSendMessageContract>
export type SlackReadMessagesResponse = ContractJsonResponse<typeof slackReadMessagesContract>
export type SlackReactionResponse = ContractJsonResponse<typeof slackAddReactionContract>
export type SlackDeleteMessageResponse = ContractJsonResponse<typeof slackDeleteMessageContract>
export type SlackUpdateMessageResponse = ContractJsonResponse<typeof slackUpdateMessageContract>
export type SlackSendEphemeralResponse = ContractJsonResponse<typeof slackSendEphemeralContract>
export type SlackDownloadResponse = ContractJsonResponse<typeof slackDownloadContract>
export type DiscordSendMessageResponse = ContractJsonResponse<typeof discordSendMessageContract>
export type DiscordChannelsResponse = ContractJsonResponse<typeof discordChannelsContract>
export type DiscordServersResponse = ContractJsonResponse<typeof discordServersContract>
export type SmsSendResponse = ContractJsonResponse<typeof smsSendContract>
export type SmtpSendResponse = ContractJsonResponse<typeof smtpSendContract>
export type SendGridSendMailResponse = ContractJsonResponse<typeof sendGridSendMailContract>
export type TelegramSendDocumentResponse = ContractJsonResponse<typeof telegramSendDocumentContract>
export type TwilioGetRecordingResponse = ContractJsonResponse<typeof twilioGetRecordingContract>

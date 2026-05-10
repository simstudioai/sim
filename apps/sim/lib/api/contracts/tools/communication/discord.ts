import { z } from 'zod'
import {
  defineCommunicationToolContract,
  discordBotTokenSelectorSchema,
  discordIdSchema,
  discordRequiredIdSchema,
} from '@/lib/api/contracts/tools/communication/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

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

export type DiscordSendMessageBody = ContractBodyInput<typeof discordSendMessageContract>
export type DiscordChannelsBody = ContractBodyInput<typeof discordChannelsContract>
export type DiscordServersBody = ContractBodyInput<typeof discordServersContract>

export type DiscordSendMessageResponse = ContractJsonResponse<typeof discordSendMessageContract>
export type DiscordChannelsResponse = ContractJsonResponse<typeof discordChannelsContract>
export type DiscordServersResponse = ContractJsonResponse<typeof discordServersContract>

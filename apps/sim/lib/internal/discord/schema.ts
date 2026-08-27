import { z } from 'zod'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

export const discordSendMessageInputSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  channelId: z.string().min(1, 'Channel ID is required'),
  content: z.string().optional().nullable(),
  files: RawFileInputArraySchema.optional().nullable(),
})

export type DiscordSendMessageInput = z.output<typeof discordSendMessageInputSchema>

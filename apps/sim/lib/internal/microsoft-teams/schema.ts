import { z } from 'zod'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

export const MAX_TEAMS_MESSAGE_FILES = 25

const messageFilesSchema = RawFileInputArraySchema.max(
  MAX_TEAMS_MESSAGE_FILES,
  `At most ${MAX_TEAMS_MESSAGE_FILES} files can be attached to one Teams message`
)

export const microsoftTeamsWriteChatInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  content: z.string().min(1, 'Message content is required'),
  files: messageFilesSchema.optional().nullable(),
})

export const microsoftTeamsWriteChannelInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  teamId: z.string().min(1, 'Team ID is required'),
  channelId: z.string().min(1, 'Channel ID is required'),
  content: z.string().min(1, 'Message content is required'),
  files: messageFilesSchema.optional().nullable(),
})

export type MicrosoftTeamsWriteChatInput = z.infer<typeof microsoftTeamsWriteChatInputSchema>
export type MicrosoftTeamsWriteChannelInput = z.infer<typeof microsoftTeamsWriteChannelInputSchema>

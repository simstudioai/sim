import { z } from 'zod'
import type { SettingsContext } from '@/lib/mothership/application/settings-context'
import {
  archivedChatListInputSchema,
  listWorkspaceChats,
  projectArchivedChatsForTool,
  restoreMothershipChat,
} from '@/lib/mothership/chat/application/use-cases'
import { listOrganizationChats } from '@/lib/mothership/chat/organization-chats'
import {
  settingsOperation,
  settingsOrganizationId,
  settingsWorkspaceId,
} from '@/lib/mothership/tools/server/settings-operation'

export async function readArchivedSettingsChats(context: SettingsContext, limit = 100) {
  const chats =
    context.scope === 'organization'
      ? await listOrganizationChats.execute({
          principal: context.principal,
          input: { organizationId: settingsOrganizationId(context), scope: 'archived', limit },
        })
      : await listWorkspaceChats.execute({
          principal: context.principal,
          input: { workspaceId: settingsWorkspaceId(context), scope: 'archived', limit },
        })
  return { chats: projectArchivedChatsForTool(chats), limit }
}

export const archivedChatSettingsActions = {
  list_chats: settingsOperation(archivedChatListInputSchema, (context, { limit }) =>
    readArchivedSettingsChats(context, limit)
  ),
  restore_chat: settingsOperation(
    z.strictObject({ chatId: z.string().min(1).max(200) }),
    async (context, input) => {
      const result = await restoreMothershipChat.execute({
        principal: context.principal,
        input: {
          ...input,
          ...(context.scope === 'organization'
            ? { assertedOrganizationId: settingsOrganizationId(context) }
            : { assertedWorkspaceId: settingsWorkspaceId(context) }),
        },
      })
      return { status: 'restored', chatId: result.chatId }
    }
  ),
}

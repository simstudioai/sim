import 'server-only'
import type { ConversationMode } from '@/lib/mothership/chat/intent'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import { requireSessionViewer } from '@/platform/lib/data/server-read'
import { readWorkspaceShellOrganizationId } from '@/platform/lib/data/shell-scope'

/**
 * Whether the viewer may open a chat under `organizationId`'s URL, and in which mode. The chat
 * route's own access check decides access, and the chat must belong to that organization: an
 * organization chat to it, a workspace chat to the organization its workspace opens in for the
 * viewer. Anything else is `null` (not found), so one organization's URL never renders another's
 * chat. Any other failure propagates to the error boundary rather than rendering an empty chat.
 */
export async function readChatMode(
  chatId: string,
  organizationId: string
): Promise<ConversationMode | null> {
  const { principal } = await requireSessionViewer()
  const chat = await getAccessibleCopilotChatAuth(chatId, principal.userId, { principal })
  if (!chat) return null
  const chatOrganizationId =
    chat.organizationId ??
    (chat.workspaceId ? await readWorkspaceShellOrganizationId(chat.workspaceId) : null)
  return chatOrganizationId === organizationId ? chat.mode : null
}

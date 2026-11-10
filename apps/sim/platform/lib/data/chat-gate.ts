import 'server-only'
import type { ConversationMode } from '@/lib/mothership/chat/intent'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import type { OpenedChat } from '@/platform/lib/data/chat'
import { requireSessionViewer } from '@/platform/lib/data/server-read'
import { readWorkspaceShellOrganizationId } from '@/platform/lib/data/shell-scope'

interface ChatEntry {
  mode: ConversationMode
  /** What the route hands the conversation: the chat, with the scope its requests name. */
  chat: OpenedChat
}

/**
 * Whether the viewer may open a chat under `organizationId`'s URL, in which mode, and where it
 * lives. The chat route's own access check decides access, and the chat must belong to that
 * organization: an organization chat to it, a workspace chat to the organization its workspace
 * opens in for the viewer. Anything else is `null` (not found), so one organization's URL never
 * renders another's chat. Any other failure propagates to the error boundary rather than rendering
 * an empty chat.
 *
 * A workspace chat's entry keeps its workspace: the server admits a send or a Stop only under the
 * scope the chat was created in, so the conversation names that workspace, never this organization.
 */
export async function readOpenChat(
  chatId: string,
  organizationId: string
): Promise<ChatEntry | null> {
  const { principal } = await requireSessionViewer()
  const chat = await getAccessibleCopilotChatAuth(chatId, principal.userId, { principal })
  if (!chat) return null
  const chatOrganizationId =
    chat.organizationId ??
    (chat.workspaceId ? await readWorkspaceShellOrganizationId(chat.workspaceId) : null)
  if (chatOrganizationId !== organizationId) return null
  const workspaceId = chat.organizationId ? null : chat.workspaceId
  return { mode: chat.mode, chat: { id: chat.id, ...(workspaceId ? { workspaceId } : {}) } }
}

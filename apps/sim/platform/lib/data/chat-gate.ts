import 'server-only'
import type { ConversationMode } from '@/lib/mothership/chat/intent'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import { requireSessionViewer } from '@/platform/lib/data/server-read'

/**
 * Whether the viewer may open a chat, and in which mode. This is the chat route's own access check:
 * a chat outside the viewer's access is `null`, and any other failure propagates to the error
 * boundary rather than rendering an empty chat.
 */
export async function readChatMode(chatId: string): Promise<ConversationMode | null> {
  const { principal } = await requireSessionViewer()
  const chat = await getAccessibleCopilotChatAuth(chatId, principal.userId, { principal })
  return chat?.mode ?? null
}

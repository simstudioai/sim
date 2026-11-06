import 'server-only'
import { isApiClientError } from '@/lib/api/client/errors'
import { getMothershipChatContract } from '@/lib/api/contracts/mothership-chats'
import { serverRequestJson } from '@/platform/lib/data/server-request'

/**
 * Whether the viewer may open a chat, and in which mode. The chat API answers 404 outside the
 * viewer's access, so this read is the authorization; any other failure propagates to the error
 * boundary rather than rendering an empty chat.
 */
export async function readChatMode(chatId: string): Promise<'agent' | 'assistant' | 'plan' | null> {
  try {
    const { chat } = await serverRequestJson(getMothershipChatContract, {
      params: { chatId },
      query: {},
    })
    return chat.mode
  } catch (error) {
    if (isApiClientError(error) && (error.status === 404 || error.status === 403)) return null
    throw error
  }
}

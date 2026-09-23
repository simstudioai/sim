import { type ForkChatRequest, ForkChatResponse } from '@/lib/mothership/generated/protocol'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

/** A lost copy acknowledgement retries the same destination and immutable request. */
export async function copyWorkerConversation(request: ForkChatRequest): Promise<void> {
  const baseURL = await getMothershipBaseURL({ userId: request.userId })
  const body = JSON.stringify(request)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchGo(`${baseURL}/api/chats/fork`, {
        method: 'POST',
        headers: mothershipRequestHeaders(),
        body,
        signal: AbortSignal.timeout(15_000),
        spanName: 'sim → worker /api/chats/fork',
        operation: 'fork_chat',
      })
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) {
          await response.body?.cancel()
          continue
        }
        throw new Error('The conversation could not be copied. Retry the fork.')
      }
      const receipt = ForkChatResponse.parse(await response.json())
      if (receipt.chatId !== request.newChatId)
        throw new Error('The fork returned a different chat')
      return
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
}

import { createHash } from 'node:crypto'
import { isPlainRecord } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { compactMcpPresentation, MCP_PRESENTATION_MAX_BYTES } from '@/lib/mcp/presentation'
import { mcpPresentationKey } from '@/lib/mcp/presentation-storage'
import type { ChatBlobCopyTask } from '@/lib/mothership/chat/fork-chat-files'

function presentationIds(message: unknown, includeUnpublished: boolean): string[] {
  if (
    !isPlainRecord(message) ||
    message.role !== 'assistant' ||
    !Array.isArray(message.contentBlocks)
  )
    return []
  const ids = new Set<string>()
  for (const block of message.contentBlocks) {
    if (!isPlainRecord(block) || !isPlainRecord(block.toolCall)) continue
    const call = block.toolCall
    const receipt = isPlainRecord(call.result)
      ? compactMcpPresentation(call.result.output)
      : undefined
    if (receipt) ids.add(receipt.mcpPresentation.id)
    else if (
      includeUnpublished &&
      typeof call.name === 'string' &&
      (call.name === 'mcp_run_operation' || call.name.startsWith('mcp-')) &&
      typeof call.id === 'string' &&
      call.id.length > 0 &&
      call.id.length <= 256
    )
      ids.add(createHash('sha256').update(call.id).digest('hex'))
  }
  return [...ids]
}

/** Keys always derive from the row's canonical chat, never a client-supplied storage address. */
export function mcpPresentationCleanupKeys(chatId: string, message: unknown): string[] {
  return presentationIds(message, true).map((id) => mcpPresentationKey(chatId, id))
}

export function planForkMcpPresentations(
  messages: readonly unknown[],
  sourceChatId: string,
  newChatId: string
): ChatBlobCopyTask[] {
  const ids = new Set(messages.flatMap((message) => presentationIds(message, false)))
  if (ids.size > 100)
    throw new OrchestrationError(
      'payload_too_large',
      'A chat fork can copy at most 100 MCP results'
    )
  return [...ids].map((id) => {
    const sourceKey = mcpPresentationKey(sourceChatId, id)
    return {
      copyId: sourceKey,
      sourceKey,
      targetKey: mcpPresentationKey(newChatId, id),
      context: 'mothership',
      fileName: 'mcp-result.json',
      contentType: 'application/json',
      maxBytes: MCP_PRESENTATION_MAX_BYTES,
      persistMetadata: false,
    }
  })
}

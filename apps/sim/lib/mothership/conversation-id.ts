import { generateId } from '@sim/utils/id'
import { uuidV5 } from '@/lib/core/utils/uuid-v5'

/**
 * Namespace for chat ids derived from block conversation ids. Changing it
 * re-keys every derived conversation, so every running block thread would
 * lose its history. It must never change.
 */
const MOTHERSHIP_CONVERSATION_NAMESPACE = '2b7c5e0a-4f61-5d3e-9a8b-7c1d0e2f3a45'

export interface ResolvedMothershipConversation {
  /** The id the block exposes; feeding it to another Sim block continues the thread. */
  conversationId: string
  /** The chat id sent over the wire, derived from the workspace and the conversation id. */
  chatId: string
}

/**
 * Resolves the chat id a Sim block conversation runs under.
 *
 * Builders may choose any stable string such as `customer-456` so a workflow
 * continues one thread per customer, and chat ids are UUIDs everywhere
 * downstream (`copilot_chats.id`, `workspace_files.chat_id`, and the copilot
 * service's own conversation store). Every conversation id, UUID-shaped or not,
 * is mapped to a UUID derived from the workspace and the id: the same value
 * keeps the same thread across runs, two workspaces choosing the same value
 * never share a conversation, a block can never reach a chat it did not derive
 * (the copilot store has no ownership check of its own), and the literal value
 * (which may carry a resolved secret) never leaves the executor. An omitted id
 * mints a fresh token so the exposed id still continues the thread when chained.
 */
export function resolveMothershipConversation(
  workspaceId: string,
  conversationId: unknown
): ResolvedMothershipConversation {
  if (!workspaceId) {
    throw new Error('Workspace context is required to resolve a Sim conversation')
  }
  const provided = typeof conversationId === 'string' ? conversationId.trim() : ''
  const token = provided || generateId()
  return {
    conversationId: token,
    chatId: uuidV5(`${workspaceId}:${token}`, MOTHERSHIP_CONVERSATION_NAMESPACE),
  }
}

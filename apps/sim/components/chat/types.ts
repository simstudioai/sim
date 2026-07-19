import type { ChatContext } from '@/stores/panel'

/**
 * The types a chat *turn* is made of, shared by every surface that draws one —
 * the Sim chat in the workspace, and an interface's chat module mounted on an
 * anonymous share page.
 *
 * Deliberately free of workspace concepts. A message, its attachments, and the
 * mentions inside it look the same wherever the turn came from; who may act on
 * them is the mounting surface's business, not the renderer's.
 */

/** Union of all valid context kind strings, derived from {@link ChatContext}. */
export type ChatContextKind = ChatContext['kind']

/** One `@mention` / `/command` resolved inside a user turn. */
export interface ChatMessageContext {
  kind: ChatContextKind
  label: string
  workflowId?: string
  knowledgeId?: string
  tableId?: string
  interfaceId?: string
  fileId?: string
  folderId?: string
  chatId?: string
  blockType?: string
  skillId?: string
  serverId?: string
}

/** One file carried by a user turn, as the transcript stores it. */
export interface ChatMessageAttachment {
  id: string
  filename: string
  media_type: string
  size: number
  previewUrl?: string
}

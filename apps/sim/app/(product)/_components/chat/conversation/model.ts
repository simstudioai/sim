import type {
  ChatAttachment,
  ChatTurn,
  ComposerInventory,
} from '@/app/(product)/_components/composer/model'

export interface ConversationData {
  threads: { id: string; title: string; turns: ChatTurn[] }[]
  composerInventory: ComposerInventory
  draftAttachments: ChatAttachment[]
}

export const CHAT_PLACEHOLDERS = {
  first: 'Ask about your business, or give Sim something to do…',
  followUp: 'Ask a follow-up…',
  running: 'Add a follow-up…',
}

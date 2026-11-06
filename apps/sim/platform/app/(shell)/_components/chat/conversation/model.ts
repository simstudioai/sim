import type {
  ChatAttachment,
  ChatTurn,
  ComposerReferences,
} from '@/platform/app/(shell)/_components/composer/model'

export interface ConversationData {
  threads: { id: string; title: string; turns: ChatTurn[] }[]
  references: ComposerReferences
  draftAttachments: ChatAttachment[]
}

export const CHAT_PLACEHOLDERS = {
  first: 'Ask about your business, or give Sim something to do…',
  followUp: 'Ask a follow-up…',
  running: 'Add a follow-up…',
}

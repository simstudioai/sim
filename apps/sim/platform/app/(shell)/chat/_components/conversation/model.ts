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

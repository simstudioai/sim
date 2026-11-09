'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { Conversation } from '@/app/(product)/_components/chat/conversation/conversation'
import {
  CHAT_PLACEHOLDERS,
  type ConversationData,
} from '@/app/(product)/_components/chat/conversation/model'
import {
  useChatChanges,
  useFixtureChatRuntime,
} from '@/app/(product)/_components/session/chat-changes'
import { useComposerHost } from '@/app/(product)/_components/session/composer-host'

interface FixtureChatProps {
  data: ConversationData | null
  chatId?: string
}

export function FixtureChat({ data, chatId }: FixtureChatProps) {
  const id = chatId ?? ''
  const changes = useChatChanges()
  const runtime = useFixtureChatRuntime(data?.threads, chatId)
  const thread = data?.threads.some((item) => item.id === chatId)
  const composer = useComposerHost().useComposer({
    draftKey: `chat/${id}`,
    ...data?.composerInventory,
    initialAttachments: !id || thread ? data?.draftAttachments : undefined,
  })
  if (chatId && !thread && !changes.created.some((item) => item.id === chatId)) {
    return <EmptyState title='Chat not found' />
  }
  return (
    <Conversation key={id} runtime={runtime} composer={composer} placeholders={CHAT_PLACEHOLDERS} />
  )
}

'use client'

import { Conversation } from '@/platform/app/(shell)/_components/chat/conversation/conversation'
import type { ConversationData } from '@/platform/app/(shell)/_components/chat/conversation/model'
import { useFixtureChatRuntime } from '@/platform/app/(shell)/_components/session/chat-changes'
import { useComposerHost } from '@/platform/app/(shell)/_components/session/composer-host'

const PLACEHOLDERS = {
  first: 'Ask about your business, or give Sim something to do…',
  followUp: 'Ask a follow-up…',
  running: 'Add a follow-up…',
}

interface FixtureChatProps {
  data: ConversationData | null
  chatId?: string
}

export function FixtureChat({ data, chatId }: FixtureChatProps) {
  const id = chatId ?? ''
  const runtime = useFixtureChatRuntime(data?.threads, chatId)
  const thread = data?.threads.some((item) => item.id === chatId)
  const composer = useComposerHost().useComposer({
    draftKey: `chat/${id}`,
    references: data?.references,
    initialAttachments: !id || thread ? data?.draftAttachments : undefined,
  })
  return <Conversation key={id} runtime={runtime} composer={composer} placeholders={PLACEHOLDERS} />
}

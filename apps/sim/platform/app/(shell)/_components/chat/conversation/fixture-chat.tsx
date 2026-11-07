'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { Conversation } from '@/platform/app/(shell)/_components/chat/conversation/conversation'
import {
  CHAT_PLACEHOLDERS,
  type ConversationData,
} from '@/platform/app/(shell)/_components/chat/conversation/model'
import {
  useChatChanges,
  useFixtureChatRuntime,
} from '@/platform/app/(shell)/_components/session/chat-changes'
import { useComposerHost } from '@/platform/app/(shell)/_components/session/composer-host'
import { chatPath } from '@/platform/lib/workspace-navigation'

interface FixtureChatProps {
  data: ConversationData | null
  workspaceId?: string
  chatId?: string
}

export function FixtureChat({ data, chatId, workspaceId }: FixtureChatProps) {
  const id = chatId ?? ''
  const changes = useChatChanges()
  const runtime = useFixtureChatRuntime(data?.threads, chatId, workspaceId)
  const thread = data?.threads.some((item) => item.id === chatId)
  const composer = useComposerHost().useComposer({
    draftKey: workspaceId ? chatPath(id, workspaceId) : `chat/${id}`,
    ...data?.composerInventory,
    initialAttachments: !id || thread ? data?.draftAttachments : undefined,
  })
  const created = changes.created.find((item) => item.id === chatId)
  if (chatId && !thread && (!created || created.workspaceId !== workspaceId)) {
    return <EmptyState title='Chat not found' />
  }
  return (
    <Conversation key={id} runtime={runtime} composer={composer} placeholders={CHAT_PLACEHOLDERS} />
  )
}

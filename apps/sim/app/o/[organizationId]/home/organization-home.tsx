'use client'

import { useEffect, useState } from 'react'
import { useSession } from '@/lib/auth/auth-client'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { GetStarted } from '@/app/o/[organizationId]/home/components/get-started'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'

interface OrganizationHomeProps {
  userName?: string
  chatId?: string
}

/** Search and private Assistant chats for the routed organization. */
export function OrganizationHome(props: OrganizationHomeProps) {
  const { organization, searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationHomeContent key={`${organization.id}:${props.chatId ?? 'new'}`} {...props} />
}

function OrganizationHomeContent({ userName, chatId }: OrganizationHomeProps) {
  const { organization } = useOrganizationContext()
  const { data: session } = useSession()
  const [draft, setDraft] = useState('')
  const chat = useChat({ organizationId: organization.id }, chatId)
  const { sendMessage } = chat
  const { mutate: markRead } = useMarkMothershipChatRead({ organizationId: organization.id })
  const firstName = userName?.split(' ')[0] ?? ''

  useEffect(() => {
    if (chat.resolvedChatId && !chat.isSending && !chat.isReconnecting)
      markRead(chat.resolvedChatId)
  }, [chat.resolvedChatId, chat.isSending, chat.isReconnecting, markRead])

  useEffect(() => {
    if (chatId) return
    const handoff = MothershipHandoffStorage.consume({ organizationId: organization.id })
    if (handoff?.message) {
      void sendMessage(handoff.message, undefined, undefined, {
        requestMode: 'assistant',
        ...(handoff.resumeUserMessageId
          ? { resumeUserMessageId: handoff.resumeUserMessageId }
          : {}),
        ...(handoff.assistantSearch ? { assistantSearch: handoff.assistantSearch } : {}),
      })
    }
  }, [chatId, organization.id, sendMessage])

  const send = (message: string) => {
    void sendMessage(message, undefined, undefined, { requestMode: 'assistant' })
  }

  const submit = () => {
    const message = draft.trim()
    if (!message) return
    setDraft('')
    send(message)
  }

  const hasChat = Boolean(chatId || chat.messages.length)
  const composer = (
    <Composer
      value={draft}
      isInitialView={!hasChat}
      isSending={chat.isSending || chat.isReconnecting}
      onChange={setDraft}
      onSubmit={submit}
      onStop={() => {
        void chat.stopGeneration()
      }}
    />
  )

  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      {hasChat ? (
        <MothershipChat
          messages={chat.messages}
          isSending={chat.isSending}
          isReconnecting={chat.isReconnecting}
          isLoading={Boolean(chatId) && !chat.messages.length && chat.isChatHistoryPending}
          onSubmit={send}
          onStopGeneration={() => {
            void chat.stopGeneration()
          }}
          messageQueue={chat.messageQueue}
          editingQueuedId={chat.editingQueuedId}
          dispatchingHeadId={chat.dispatchingHeadId}
          onRemoveQueuedMessage={chat.removeFromQueue}
          onSendQueuedMessage={chat.sendNow}
          onEditQueuedMessage={(id) => {
            const queued = chat.editQueuedMessage(id)
            if (queued) setDraft(queued.content)
            return queued
          }}
          onCancelQueueEdit={chat.cancelQueueEdit}
          userId={session?.user?.id}
          chatId={chat.resolvedChatId}
          composer={composer}
        />
      ) : (
        <div className='min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
          {/* Asymmetric padding biases the group up so the full cluster (heading + input + steps) sits at the optical center */}
          <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
            <h1 className='mb-7 max-w-chat text-balance font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
              What should we get done{firstName ? `, ${firstName}` : ''}?
            </h1>
            <div className='relative w-full max-w-chat'>
              {composer}
              {/* Anchored out of flow so expanding/collapsing never shifts the centered input */}
              <div className='absolute inset-x-0 top-full'>
                <GetStarted />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

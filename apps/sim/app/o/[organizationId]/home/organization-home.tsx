'use client'

import { useEffect, useState } from 'react'
import { ChipLink } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/auth-client'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { organizationRoutes } from '@/lib/navigation/paths'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { organizationHomeParsers } from '@/app/o/[organizationId]/home/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface OrganizationHomeProps {
  userName?: string
  chatId?: string
}

/** Search and private Assistant chats for the routed organization. */
export function OrganizationHome({ userName, chatId }: OrganizationHomeProps) {
  const { organization, viewer } = useOrganizationContext()
  const { data: session } = useSession()
  const [{ mode, q }, setParams] = useQueryStates(organizationHomeParsers, {
    history: 'replace',
    clearOnDefault: true,
  })
  const setSearch = useDebouncedSearchSetter((value, options) => setParams({ q: value }, options))
  const debouncedQuery = useDebounce(q, SEARCH_DEBOUNCE_MS)
  const [draft, setDraft] = useState('')
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const chat = useChat({ organizationId: organization.id }, chatId)
  const { sendMessage } = chat
  const { mutate: markRead } = useMarkMothershipChatRead({ organizationId: organization.id })

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

  function changeMode(nextMode: 'search' | 'assistant') {
    void setParams({ mode: nextMode, q: '', source: null, updated: null })
  }

  function submit() {
    const message = (mode === 'search' ? q : draft).trim()
    if (!message) return
    if (mode === 'search') {
      void setParams({ q: message })
      return
    }
    setDraft('')
    void sendMessage(message, undefined, undefined, { requestMode: 'assistant' })
  }

  async function summarize(message: string, assistantSearch: WorkspaceSearchFilters) {
    await setParams({ mode: 'assistant', q: '', source: null, updated: null })
    setDraft('')
    void sendMessage(message, undefined, undefined, { requestMode: 'assistant', assistantSearch })
  }

  const composer = (
    <Composer
      value={mode === 'search' ? q : draft}
      mode={mode}
      isSending={chat.isSending || chat.isReconnecting}
      onChange={(value) => (mode === 'search' ? setSearch(value) : setDraft(value))}
      onModeChange={changeMode}
      onSubmit={submit}
      onStop={() => {
        void chat.stopGeneration()
      }}
    />
  )
  const searchResults =
    mode === 'search' && q.trim() && debouncedQuery.trim() ? (
      <KnowledgeSearchResults scope={scope} query={debouncedQuery} onSummarize={summarize} />
    ) : null
  const hasChat = Boolean(chatId || chat.messages.length)

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {chat.error && (
        <p role='alert' className='px-6 py-2 text-[var(--text-error)] text-caption'>
          {chat.error}
        </p>
      )}
      {hasChat ? (
        <MothershipChat
          messages={chat.messages}
          isSending={chat.isSending}
          isReconnecting={chat.isReconnecting}
          isLoading={Boolean(chatId) && chat.isChatHistoryPending}
          onSubmit={(message) => {
            void sendMessage(message, undefined, undefined, { requestMode: 'assistant' })
          }}
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
            if (queued) {
              changeMode('assistant')
              setDraft(queued.content)
            }
            return queued
          }}
          onCancelQueueEdit={chat.cancelQueueEdit}
          userId={session?.user?.id}
          chatId={chat.resolvedChatId}
          composer={composer}
          searchResults={searchResults}
        />
      ) : (
        <div className='min-h-0 flex-1 overflow-y-auto px-6 py-12'>
          <div className='mx-auto flex w-full max-w-chat flex-col gap-6'>
            <h1 className='font-season text-2xl text-[var(--text-primary)]'>
              What would you like to find
              {userName?.split(' ')[0] ? `, ${userName.split(' ')[0]}` : ''}?
            </h1>
            {composer}
            {searchResults}
            <div className='flex items-center gap-2'>
              <ChipLink href={organizationRoutes(organization.id).integrations}>
                {viewer.isAdmin ? 'Manage sources' : 'Connect your accounts'}
              </ChipLink>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

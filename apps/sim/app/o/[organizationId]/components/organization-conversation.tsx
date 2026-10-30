'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { toRecord } from '@sim/utils/object'
import { useQueryClient } from '@tanstack/react-query'
import { createSerializer, useQueryStates } from 'nuqs'
import { AssistantActionReviewProvider } from '@/components/assistant-actions'
import { requestJson } from '@/lib/api/client/request'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { getWorkspaceHostContextContract } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/client'
import { BrowserStorage, MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import {
  getMothershipAttachmentPreviewUrl,
  getMothershipAttachmentUrl,
} from '@/lib/mothership/chat/attachment-preview'
import { createSearchResource } from '@/lib/mothership/resources/search'
import { organizationRoutes } from '@/lib/navigation/paths'
import { OrganizationLanding } from '@/app/o/[organizationId]/components/organization-landing'
import { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { GetStarted } from '@/app/o/[organizationId]/home/components/get-started'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/app/o/[organizationId]/search/search-params'
import { ChatResourcePanel } from '@/app/workspace/[workspaceId]/home/components/chat-resource-panel'
import { useSearchHistoryActions } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-history-context'
import { SearchIntegrationConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat'
import { SuggestedActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import {
  getMothershipUseChatOptions,
  useChat,
} from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/app/workspace/[workspaceId]/home/hooks/use-resource-panel'
import { useRestoredChatEntry } from '@/app/workspace/[workspaceId]/home/hooks/use-restored-chat-entry'
import { fetchWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'
import {
  resourceParam,
  searchFilterParsers,
  searchFiltersFromParams,
} from '@/app/workspace/[workspaceId]/home/search-params'
import type {
  ChatRequestMode,
  FileAttachmentForApi,
  WorkspaceResourceRef,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { mentionifyIntegrations } from '@/blocks/integration-matcher'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'
import { useHydrated } from '@/hooks/use-hydrated'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import type { ChatContext } from '@/stores/panel'

export interface OrganizationSummaryRequest {
  id: string
  message: string
  assistantSearch: WorkspaceSearchFilters
}

const serializeSearchConversation = createSerializer({
  ...organizationSearchParsers,
  ...searchFilterParsers,
  [resourceParam.key]: resourceParam.parser,
})

interface OrganizationConversationProps {
  active?: boolean
  summaryRequest?: OrganizationSummaryRequest
  onSummaryConsumed?: (id: string) => void
  userName?: string
  chatId?: string
  requestMode: ChatRequestMode
  header?: ReactNode
}

/** Shared conversation surface; the destination fixes its intent before the first turn. */
export function OrganizationConversation(props: OrganizationConversationProps) {
  const { organization, searchAccess, canBuild, mothershipAvailable } = useOrganizationContext()
  const { data: session } = useSession()
  const isClient = useHydrated()
  const isRestoredChatEntry = useRestoredChatEntry({ chatId: props.chatId })
  if (
    !mothershipAvailable ||
    (props.requestMode === 'assistant' ? !searchAccess.memberScoped : !canBuild)
  )
    return null
  if (isRestoredChatEntry || !isClient || !session?.user?.id)
    return <HomeFallback header={props.header} />
  return (
    <OrganizationConversationContent
      key={`${session.user.id}:${organization.id}:${props.chatId ?? 'new'}:${props.requestMode}`}
      {...props}
    />
  )
}

function OrganizationConversationContent({
  userName,
  chatId,
  requestMode: destinationMode,
  header,
  active = true,
  summaryRequest,
  onSummaryConsumed,
}: OrganizationConversationProps) {
  const { organization, canBuild } = useOrganizationContext()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const planEnabled = useFeatureFlag('mothership-plan-mode')
  const [planning, setPlanning] = useState(false)
  const requestMode =
    destinationMode === 'agent' && !chatId && planEnabled && planning ? 'plan' : destinationMode
  const [searchParams] = useQueryStates(
    { ...organizationSearchParsers, ...searchFilterParsers },
    organizationSearchUrlKeys
  )
  const { q, source, updated, from, to } = searchParams
  const controller = useResourcePanelController()
  const queryClient = useQueryClient()
  const chat = useChat(
    { organizationId: organization.id },
    chatId,
    getMothershipUseChatOptions({
      requestMode,
      getChatUrl:
        destinationMode === 'assistant'
          ? (id) =>
              serializeSearchConversation(organizationRoutes(organization.id).searchChat(id), {
                ...searchParams,
                mode: active ? 'assistant' : 'search',
                resource: controller.activeResourceState[0],
              })
          : undefined,
      onResourceEvent: controller.onResourceEvent,
      activeResourceState: controller.activeResourceState,
    })
  )
  const newDraftId = destinationMode === 'assistant' ? 'search-assistant' : 'home'
  const initialDraftKey = `${userId}:organization:${organization.id}:${chatId ?? newDraftId}`
  const draftKey = `${userId}:organization:${organization.id}:${chat.resolvedChatId ?? chatId ?? newDraftId}`
  const [legacyDraftKey] = useState(() => {
    if (chatId) return null
    const key = `${userId}:organization:${organization.id}:new`
    if (!useMothershipDraftsStore.getState().drafts[key]) return null
    const persisted = toRecord(BrowserStorage.getItem<unknown>('organization-chat-mode', null))
    const modes = toRecord(toRecord(persisted.state).modes)
    const legacyMode =
      !canBuild || modes[`${userId}:${organization.id}`] === 'assistant' ? 'assistant' : 'agent'
    return legacyMode === destinationMode ? key : null
  })
  const savedDraft = useMothershipDraftsStore.getState().drafts
  const initialDraft =
    savedDraft[draftKey] ??
    savedDraft[initialDraftKey] ??
    (legacyDraftKey ? savedDraft[legacyDraftKey] : undefined)
  const draft = useMothershipDraftsStore(
    (state) =>
      (
        state.drafts[draftKey] ??
        state.drafts[initialDraftKey] ??
        (legacyDraftKey ? state.drafts[legacyDraftKey] : undefined)
      )?.text ?? ''
  )
  const setDraft = useCallback(
    (text: string, contexts?: ChatContext[]) => {
      const store = useMothershipDraftsStore.getState()
      store.setDraft(draftKey, { ...store.drafts[draftKey], text, contexts })
    },
    [draftKey]
  )
  const [restoredContexts, setRestoredContexts] = useState<ChatContext[]>(
    () => initialDraft?.contexts ?? []
  )
  useEffect(() => {
    const store = useMothershipDraftsStore.getState()
    if (legacyDraftKey) store.migrateDraft(legacyDraftKey, initialDraftKey)
    store.migrateDraft(initialDraftKey, draftKey)
  }, [initialDraftKey, draftKey, legacyDraftKey])
  const hasChat = Boolean(chatId || chat.messages.length)
  const assistantSearchLevel = 'fast'
  const panel = useChatResourcePanel(chat, controller, userId)
  const addResource = panel.addResourceFromUser
  /** Restore an explicitly selected results tab before the first turn; closing it clears the URL. */
  useEffect(() => {
    if (hasChat || !q.trim()) return
    const resource = createSearchResource({
      scope: { kind: 'organization', organizationId: organization.id },
      query: q.trim(),
      filters: searchFiltersFromParams({ source, updated, from, to }, Date.now()),
    })
    if (
      controller.activeResourceParam !== resource.id ||
      chat.resources.some((entry) => entry.id === resource.id)
    )
      return
    addResource(resource)
  }, [
    hasChat,
    q,
    source,
    updated,
    from,
    to,
    organization.id,
    controller.activeResourceParam,
    chat.resources,
    addResource,
  ])
  const selectResource = async (ref: WorkspaceResourceRef) => {
    if (!ref.workspaceId) {
      toast.error('This resource has no workspace address.')
      return
    }
    try {
      const host = await requestJson(getWorkspaceHostContextContract, {
        params: { id: ref.workspaceId },
      })
      if (host.hostOrganizationId !== organization.id) {
        toast.error('This resource is outside this organization.')
        return
      }
      const resource = await fetchWorkspaceResourceRef(queryClient, ref.workspaceId, ref)
      if (!resource) {
        toast.error(`Couldn't find "${ref.title}" in its workspace`)
        return
      }
      addResource({ ...resource, workspaceId: ref.workspaceId })
    } catch {
      toast.error(`Couldn't open "${ref.title}". Check your access and try again.`)
    }
  }
  const files = useFileAttachments({
    userId: session?.user?.id,
    organizationId: organization.id,
    requestMode,
    initialAttachments: initialDraft?.fileAttachments,
  })
  useEffect(() => {
    const store = useMothershipDraftsStore.getState()
    const fileAttachments = files.attachedFiles.flatMap((file) =>
      !file.uploading && file.key
        ? [
            {
              id: file.id,
              key: file.key,
              filename: file.name,
              media_type: file.type,
              size: file.size,
              path: file.path,
            },
          ]
        : []
    )
    store.setDraft(draftKey, {
      ...(store.drafts[draftKey] ?? { text: '' }),
      fileAttachments,
    })
  }, [draftKey, files.attachedFiles])
  useEffect(() => {
    if (chat.error) toast.error(chat.error)
  }, [chat.error])
  const { recordQuery } = useSearchHistoryActions()
  const { sendMessage } = chat
  const { mutate: markRead } = useMarkMothershipChatRead({ organizationId: organization.id })
  const firstName = userName?.split(' ')[0] ?? ''

  useEffect(() => {
    if (active && chat.resolvedChatId && !chat.isSending && !chat.isReconnecting)
      markRead(chat.resolvedChatId)
  }, [active, chat.resolvedChatId, chat.isSending, chat.isReconnecting, markRead])

  const consumedSummary = useRef<string | null>(null)
  useEffect(() => {
    if (!active || !summaryRequest || consumedSummary.current === summaryRequest.id) return
    consumedSummary.current = summaryRequest.id
    onSummaryConsumed?.(summaryRequest.id)
    void sendMessage(summaryRequest.message, undefined, undefined, {
      requestMode: 'assistant',
      assistantSearchLevel,
      assistantSearch: summaryRequest.assistantSearch,
    })
  }, [active, summaryRequest, onSummaryConsumed, sendMessage])

  useEffect(() => {
    if (chatId) return
    const handoff = MothershipHandoffStorage.consume(
      { organizationId: organization.id },
      undefined,
      requestMode
    )
    if (handoff && (handoff.message || handoff.fileAttachments?.length)) {
      void sendMessage(handoff.message ?? '', handoff.fileAttachments, handoff.contexts, {
        requestMode,
        ...(handoff.resumeUserMessageId
          ? { resumeUserMessageId: handoff.resumeUserMessageId }
          : {}),
        ...(requestMode === 'assistant'
          ? {
              assistantSearchLevel,
            }
          : {}),
        ...(handoff.assistantSearch ? { assistantSearch: handoff.assistantSearch } : {}),
      })
    }
  }, [chatId, organization.id, requestMode, sendMessage, assistantSearchLevel])

  const send = (
    message: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[],
    assistantSearch?: WorkspaceSearchFilters
  ) => {
    if (requestMode !== 'assistant' && !canBuild) return
    if (requestMode === 'assistant') recordQuery(message)
    if (requestMode !== 'assistant') panel.prepareResourceViewForAgentTurn()
    void sendMessage(message, fileAttachments, contexts, {
      requestMode,
      ...(requestMode === 'assistant' ? { assistantSearchLevel } : {}),
      ...(assistantSearch ? { assistantSearch } : {}),
    })
  }
  const submit = (text: string, contexts?: ChatContext[]) => {
    const message = text.trim()
    if (files.attachedFiles.some((file) => file.uploading)) return
    const attachments: FileAttachmentForApi[] = files.attachedFiles.flatMap((file) =>
      file.key
        ? [
            {
              id: file.id,
              key: file.key,
              filename: file.name,
              media_type: file.type,
              size: file.size,
              path: file.path,
            },
          ]
        : []
    )
    if (!message && !attachments.length) return
    useMothershipDraftsStore.getState().clearDraft(draftKey)
    send(message, attachments.length ? attachments : undefined, contexts)
    setRestoredContexts([])
    files.clearAttachedFiles()
  }

  const editQueuedMessage = (id: string) => {
    const queued = chat.editQueuedMessage(id)
    if (queued) {
      setDraft(queued.content, queued.contexts)
      setRestoredContexts(queued.contexts ?? [])
      files.restoreAttachedFiles(
        (queued.fileAttachments ?? []).map((file) => ({
          id: file.id,
          key: file.key,
          name: file.filename,
          type: file.media_type,
          size: file.size,
          path:
            file.path ||
            getMothershipAttachmentPreviewUrl(file) ||
            getMothershipAttachmentUrl(file),
          previewUrl: getMothershipAttachmentPreviewUrl(file),
          uploading: false,
        }))
      )
    }
    return queued
  }

  const composer = (
    <Composer
      requestMode={requestMode}
      onPlanChange={
        !hasChat && destinationMode === 'agent' && planEnabled
          ? () => setPlanning((value) => !value)
          : undefined
      }
      value={draft}
      restoredContexts={restoredContexts}
      messages={chat.messages}
      onEditQueuedTail={() => {
        const tail = chat.messageQueue.at(-1)
        return tail ? Boolean(editQueuedMessage(tail.id)) : false
      }}
      files={files}
      isInitialView={!hasChat}
      isSending={chat.isSending || chat.isReconnecting}
      onChange={setDraft}
      onSubmit={submit}
      onSendQueuedHead={() => {
        void chat.sendNow()
      }}
      onStop={() => {
        void chat.stopGeneration()
      }}
    />
  )

  const content = (
    <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)] md:min-w-[min(480px,50%)]'>
      {hasChat ? (
        <AssistantActionReviewProvider
          organizationId={organization.id}
          chatId={chat.resolvedChatId}
          messages={chat.messages}
          active={chat.isSending}
          enabled={requestMode === 'assistant'}
        >
          <MothershipChat
            reserveResourceHeader={!header}
            onViewSources={(messageId, requestId) =>
              addResource({
                type: 'sources',
                id: 'cited-sources',
                title: 'Sources',
                sources: { messageId, ...(requestId ? { requestId } : {}) },
              })
            }
            SearchConnectionComponent={SearchIntegrationConnection}
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
            onEditQueuedMessage={editQueuedMessage}
            onCancelQueueEdit={chat.cancelQueueEdit}
            userId={session?.user?.id}
            chatId={chat.resolvedChatId}
            composer={composer}
            onWorkspaceResourceSelect={requestMode !== 'assistant' ? selectResource : undefined}
            initialScrollBlocked={panel.initialScrollBlocked}
          />
        </AssistantActionReviewProvider>
      ) : (
        <OrganizationLanding
          heading={
            requestMode === 'assistant'
              ? `Search ${organization.name}`
              : requestMode === 'plan'
                ? `What should we understand and plan${firstName ? `, ${firstName}` : ''}?`
                : `What should we get done${firstName ? `, ${firstName}` : ''}?`
          }
        >
          {composer}
          <div className='relative md:absolute md:inset-x-0 md:top-full'>
            {requestMode !== 'assistant' ? (
              <SuggestedActions
                organizationId={organization.id}
                onSelectPrompt={(prompt) => setDraft(mentionifyIntegrations(prompt))}
              />
            ) : (
              <GetStarted />
            )}
          </div>
        </OrganizationLanding>
      )}
    </div>
  )
  return (
    <ChatResourcePanel
      header={header}
      allowBuildControls={requestMode !== 'assistant' && canBuild}
      organizationId={organization.id}
      chat={chat}
      panel={panel}
      onSummarize={(message, filters) => send(message, undefined, undefined, filters)}
    >
      {content}
    </ChatResourcePanel>
  )
}

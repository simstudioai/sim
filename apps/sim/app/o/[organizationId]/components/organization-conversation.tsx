'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ChipModal, ChipModalHeader, cn, toast } from '@sim/emcn'
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
import { isWorkspaceResourceKind, workspaceResourcePath } from '@/lib/resources'
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
import { SourcesResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/sources-resource-content'
import { SuggestedActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions'
import type { ModelSelectorOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'
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
  panelOptions?: {
    header: ReactNode
    attachments?: ReactNode
    resourceActions?: ReactNode
    modelSelectorOptions?: ModelSelectorOptions
    onChatIdResolved: (chatId: string) => void
    onNavigateToChat: (chatId: string) => void
    prepareSubmission: (
      message: string,
      contexts?: ChatContext[]
    ) => { message: string; contexts?: ChatContext[] } | false
    onSubmitted: () => void
    draftNamespace: string
  }
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
  panelOptions,
}: OrganizationConversationProps) {
  const { organization, canBuild } = useOrganizationContext()
  const compact = Boolean(panelOptions)
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
  const chat = useChat({ organizationId: organization.id }, chatId, {
    ...getMothershipUseChatOptions({
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
    }),
    ...(panelOptions
      ? { projectsDesktopTabs: false, onChatIdResolved: panelOptions.onChatIdResolved }
      : {}),
  })
  const newDraftId = destinationMode === 'assistant' ? 'search-assistant' : 'home'
  const draftPrefix = panelOptions ? `${panelOptions.draftNamespace}:` : ''
  const initialDraftKey = `${draftPrefix}${userId}:organization:${organization.id}:${chatId ?? newDraftId}`
  const draftKey = `${draftPrefix}${userId}:organization:${organization.id}:${chat.resolvedChatId ?? chatId ?? newDraftId}`
  const [legacyDraftKey] = useState(() => {
    if (panelOptions || chatId) return null
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
    if (compact || hasChat || !q.trim()) return
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
    compact,
  ])
  const selectResource = async (ref: WorkspaceResourceRef) => {
    if (!ref.workspaceId) {
      toast.error('This resource has no workspace address.')
      return
    }
    const destination = panelOptions ? window.open('about:blank', '_blank') : null
    if (panelOptions && !destination) {
      toast.error('Allow pop-ups to open this resource in Sim.')
      return
    }
    if (destination) destination.opener = null
    try {
      const host = await requestJson(getWorkspaceHostContextContract, {
        params: { id: ref.workspaceId },
      })
      if (host.hostOrganizationId !== organization.id) {
        destination?.close()
        toast.error('This resource is outside this organization.')
        return
      }
      const resource = await fetchWorkspaceResourceRef(queryClient, ref.workspaceId, ref)
      if (!resource) {
        destination?.close()
        toast.error(`Couldn't find "${ref.title}" in its workspace`)
        return
      }
      if (destination) {
        const kind =
          resource.type === 'knowledgebase'
            ? 'knowledge'
            : resource.type === 'filefolder'
              ? 'folder'
              : resource.type
        destination.location.replace(
          isWorkspaceResourceKind(kind)
            ? workspaceResourcePath(ref.workspaceId, kind, resource.id)
            : `/workspace/${encodeURIComponent(ref.workspaceId)}/home?resource=${encodeURIComponent(resource.id)}`
        )
      } else addResource({ ...resource, workspaceId: ref.workspaceId })
    } catch {
      destination?.close()
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
    if (compact || chatId) return
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
  }, [compact, chatId, organization.id, requestMode, sendMessage, assistantSearchLevel])

  const send = (
    message: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[],
    assistantSearch?: WorkspaceSearchFilters
  ) => {
    if (requestMode !== 'assistant' && !canBuild) return
    if (requestMode === 'assistant') recordQuery(message)
    if (requestMode !== 'assistant' && !panelOptions) panel.prepareResourceViewForAgentTurn()
    void sendMessage(message, fileAttachments, contexts, {
      requestMode,
      ...(requestMode === 'assistant' ? { assistantSearchLevel } : {}),
      ...(assistantSearch ? { assistantSearch } : {}),
    })
  }
  const submit = (text: string, contexts?: ChatContext[]) => {
    if (files.attachedFiles.some((file) => file.uploading)) return false
    const submission = panelOptions
      ? panelOptions.prepareSubmission(text.trim(), contexts)
      : { message: text.trim(), contexts }
    if (submission === false) return false
    const { message } = submission
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
    if (!message && !attachments.length) return false
    useMothershipDraftsStore.getState().clearDraft(draftKey)
    send(message, attachments.length ? attachments : undefined, submission.contexts)
    panelOptions?.onSubmitted()
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
      compact={Boolean(panelOptions)}
      attachments={panelOptions?.attachments}
      resourceActions={panelOptions?.resourceActions}
      modelSelectorOptions={panelOptions?.modelSelectorOptions}
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
    <div
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)]',
        !panelOptions && 'md:min-w-[min(480px,50%)]'
      )}
    >
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
            onNavigateToChat={panelOptions?.onNavigateToChat}
            layout={panelOptions ? 'copilot-view' : undefined}
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
            initialScrollBlocked={!panelOptions && panel.initialScrollBlocked}
          />
        </AssistantActionReviewProvider>
      ) : panelOptions ? (
        <>
          <div className='flex flex-1 items-center justify-center px-5'>
            <h1 className='text-lg'>How can I help?</h1>
          </div>
          <div className='px-3 pb-3'>{composer}</div>
        </>
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
  if (panelOptions) {
    const sourceResource = chat.resources.find(
      (resource) => resource.type === 'sources' && resource.id === controller.activeResourceParam
    )
    return (
      <main className='ph-no-capture flex h-dvh min-w-0 flex-col overflow-hidden bg-[var(--bg)] text-[var(--text-body)]'>
        {panelOptions.header}
        {content}
        <ChipModal
          open={Boolean(sourceResource)}
          onOpenChange={(open) => {
            if (!open) controller.activeResourceState[1](null)
          }}
          srTitle='Cited sources'
          size='sm'
        >
          <ChipModalHeader onClose={() => controller.activeResourceState[1](null)}>
            Cited sources
          </ChipModalHeader>
          {sourceResource && (
            <div className='h-[60dvh] min-h-0'>
              <SourcesResourceContent chatId={chat.resolvedChatId} resource={sourceResource} />
            </div>
          )}
        </ChipModal>
      </main>
    )
  }
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

'use client'

import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { OverflowText, toast } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { requestJson } from '@/lib/api/client/request'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { getWorkspaceHostContextContract } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { getDeploymentShape } from '@/lib/core/config/deployment-shape'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import {
  getMothershipAttachmentPreviewUrl,
  getMothershipAttachmentUrl,
} from '@/lib/mothership/chat/attachment-preview'
import {
  MOTHERSHIP_SEND_MESSAGE_EVENT,
  type MothershipSendMessageDetail,
} from '@/lib/mothership/events'
import { createSearchResource } from '@/lib/mothership/resources/search'
import { OrganizationLanding } from '@/app/o/[organizationId]/components/organization-landing'
import { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { GetStarted } from '@/app/o/[organizationId]/home/components/get-started'
import { projectPaneParsers } from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { useDraftResourceTabs } from '@/app/o/[organizationId]/home/components/project-pane/use-draft-resource-tabs'
import { useProjectPane } from '@/app/o/[organizationId]/home/components/project-pane/use-project-pane'
import { organizationHomeParsers } from '@/app/o/[organizationId]/home/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { organizationSearchUrlKeys } from '@/app/o/[organizationId]/search/search-params'
import { SearchResultsView } from '@/app/o/[organizationId]/search/search-results-view'
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
import { resolveWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'
import { searchFiltersFromParams } from '@/app/workspace/[workspaceId]/home/search-params'
import type {
  ChatRequestMode,
  FileAttachmentForApi,
  WorkspaceResourceRef,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { mentionifyIntegrations } from '@/blocks/integration-matcher'
import {
  useMarkMothershipChatRead,
  useOrganizationMothershipChats,
} from '@/hooks/queries/mothership-chats'
import { getWorkspaceFilesQueryOptions } from '@/hooks/queries/workspace-files'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import { useOrganizationChatModeStore } from '@/stores/organization-chat-mode/store'
import type { ChatContext } from '@/stores/panel'

/** What a host surface adds to the empty Home for one mode. */
interface OrganizationHomeLanding {
  heading?: string
  /** Rendered above the composer, such as a picker that scopes the next message. */
  accessory?: ReactNode
}

interface OrganizationHomeProps {
  userName?: string
  chatId?: string
  requestMode?: ChatRequestMode
  /** Lets a host surface change the empty Home's heading and add a control, per mode. */
  landing?: (requestMode: ChatRequestMode) => OrganizationHomeLanding | undefined
  /**
   * Called with the first message of a new chat before it is sent here; returning true means
   * the host sent it elsewhere, so this Home clears the draft and sends nothing.
   */
  onBeforeSend?: (message: string, requestMode: ChatRequestMode) => boolean
  /** False keeps the address bar where it is when the chat gets its id. */
  syncChatUrl?: boolean
}

const subscribeToClient = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/** Home chooses the conversation mode before its first message. */
export function OrganizationHome(props: OrganizationHomeProps) {
  const { organization, searchAccess, canBuild, mothershipAvailable } = useOrganizationContext()
  const { data: session } = useSession()
  const isClient = useSyncExternalStore(subscribeToClient, clientSnapshot, serverSnapshot)
  if (!mothershipAvailable || (!canBuild && !searchAccess.memberScoped)) return null
  /** Preferences are browser-persisted and keyed by user; never paint a guessed mode first. */
  if (!isClient || !session?.user?.id) return <HomeFallback />
  return (
    <OrganizationHomeContent
      key={`${session.user.id}:${organization.id}:${props.chatId ?? 'new'}`}
      {...props}
    />
  )
}

function OrganizationHomeContent({
  userName,
  chatId,
  requestMode: savedMode,
  landing,
  onBeforeSend,
  syncChatUrl,
}: OrganizationHomeProps) {
  const { organization, searchAccess, canBuild, mothershipAvailable } = useOrganizationContext()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const rememberedMode = useOrganizationChatModeStore(
    (state) => state.modes[`${userId}:${organization.id}`]
  )
  const [
    { q, source, updated, from, to, mode: composerMode, searchLevel: urlSearchLevel },
    setSearchParams,
  ] = useQueryStates(organizationHomeParsers, organizationSearchUrlKeys)
  const rememberMode = useOrganizationChatModeStore((state) => state.setMode)
  const [selectedMode, setSelectedMode] = useState<ChatRequestMode | null>(null)
  const planEnabled = useFeatureFlag('mothership-plan-mode')
  const projectViewEnabled = useFeatureFlag('org-project-view')
  const lookupMode =
    projectViewEnabled && !chatId && composerMode === 'search' && searchAccess.memberScoped
  const [, setPaneParams] = useQueryStates(projectPaneParsers)
  const onResourceSelected = useCallback(() => {
    if (!projectViewEnabled) return
    void setPaneParams((current) => ({
      pane: null,
      browse: current.browse.filter((tab) => tab.split(':')[0] !== current.pane),
    }))
  }, [projectViewEnabled, setPaneParams])
  const requestMode =
    selectedMode ??
    (urlSearchLevel && searchAccess.memberScoped && !chatId ? 'assistant' : undefined) ??
    savedMode ??
    (projectViewEnabled &&
    !chatId &&
    (composerMode === 'agent' ||
      (composerMode === 'plan' && planEnabled) ||
      (composerMode === 'assistant' && searchAccess.memberScoped))
      ? composerMode
      : undefined) ??
    (!canBuild || !mothershipAvailable
      ? 'assistant'
      : rememberedMode === 'plan' && planEnabled
        ? 'plan'
        : rememberedMode === 'assistant' && searchAccess.memberScoped
          ? 'assistant'
          : 'agent')
  const controller = useResourcePanelController({
    defaultExpanded: projectViewEnabled,
    onResourceSelected,
  })
  const queryClient = useQueryClient()
  const chat = useChat(
    { organizationId: organization.id },
    chatId,
    getMothershipUseChatOptions({
      requestMode,
      onResourceEvent: controller.onResourceEvent,
      activeResourceState: controller.activeResourceState,
      ...(syncChatUrl === false ? { syncChatUrl } : {}),
    })
  )
  useDraftResourceTabs({
    storageKey: `org-draft-tabs:${userId}:${organization.id}`,
    enabled: projectViewEnabled,
    hasChat: Boolean(chatId || chat.resolvedChatId),
    resources: chat.resources,
    addResource: chat.addResource,
  })
  const { data: organizationChats } = useOrganizationMothershipChats(organization.id)
  const chatTitle = organizationChats?.find(
    (entry) => entry.id === (chat.resolvedChatId ?? chatId)
  )?.name
  const initialDraftKey = `${userId}:organization:${organization.id}:${chatId ?? 'new'}`
  const draftKey = `${userId}:organization:${organization.id}:${chat.resolvedChatId ?? chatId ?? 'new'}`
  const savedDraft = useMothershipDraftsStore.getState().drafts
  const initialDraft = savedDraft[draftKey] ?? savedDraft[initialDraftKey]
  const draft = useMothershipDraftsStore(
    (state) =>
      (state.drafts[draftKey] ?? state.drafts[initialDraftKey])?.text ?? (lookupMode ? q : '')
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
    useMothershipDraftsStore.getState().migrateDraft(initialDraftKey, draftKey)
  }, [initialDraftKey, draftKey])
  const hasChat = Boolean(chatId || chat.messages.length)
  const canSelectMode =
    !hasChat && mothershipAvailable && canBuild && (searchAccess.memberScoped || planEnabled)
  const liveSearch = getDeploymentShape().features.liveEnterpriseSearch === true
  const assistantSearchLevel = 'fast'
  const panel = useChatResourcePanel(chat, controller, projectViewEnabled)
  const projectPane = useProjectPane(
    chat.resources,
    chat.activeResourceId,
    chat.desktopScopeId,
    panel.expandResource
  )
  const addResource = panel.addResourceFromUser
  /** Restore only an explicitly selected results tab on an empty Home; closing it clears the URL. */
  useEffect(() => {
    if (lookupMode || hasChat || !q.trim()) return
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
    lookupMode,
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
  const selectResource = useCallback(
    async (ref: WorkspaceResourceRef) => {
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
        const files =
          ref.type === 'file'
            ? await queryClient.fetchQuery(getWorkspaceFilesQueryOptions(ref.workspaceId))
            : []
        const resource = resolveWorkspaceResourceRef(ref, files)
        if (!resource) {
          toast.error(`Couldn't find "${ref.title}" in its workspace`)
          return
        }
        addResource({ ...resource, workspaceId: ref.workspaceId })
      } catch {
        toast.error(`Couldn't open "${ref.title}". Check your access and try again.`)
      }
    },
    [queryClient, addResource, organization.id]
  )
  const files = useFileAttachments({
    userId: session?.user?.id,
    organizationId: organization.id,
    requestMode,
    initialAttachments: initialDraft?.fileAttachments,
  })
  useEffect(() => {
    const store = useMothershipDraftsStore.getState()
    const fileAttachments = files.attachedFiles
      .filter((file) => !file.uploading && file.key)
      .map((file) => ({
        id: file.id,
        key: file.key!,
        filename: file.name,
        media_type: file.type,
        size: file.size,
        path: file.path,
      }))
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
  const router = useRouter()
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<MothershipSendMessageDetail>).detail
      if (event.defaultPrevented || !detail?.message) return
      const mode = detail.requestMode ?? requestMode
      if (!mothershipAvailable || (mode !== 'assistant' && !canBuild)) return
      event.preventDefault()
      if (hasChat && mode !== requestMode) {
        if (
          !MothershipHandoffStorage.store(
            { ...detail, requestMode: mode },
            { organizationId: organization.id }
          )
        ) {
          toast.error('Could not start dashboard setup in a new chat.')
          return
        }
        const params = new URLSearchParams(window.location.search)
        params.set('mode', mode)
        params.delete('q')
        params.delete('searchLevel')
        router.push(`/o/${organization.id}/home?${params}`)
        return
      }
      setSelectedMode(mode)
      void setSearchParams({ mode, searchLevel: null, q: null })
      void sendMessage(detail.message, detail.fileAttachments, detail.contexts, {
        requestMode: mode,
        ...(detail.resumeUserMessageId ? { resumeUserMessageId: detail.resumeUserMessageId } : {}),
        ...(detail.assistantSearch ? { assistantSearch: detail.assistantSearch } : {}),
        ...(detail.assistantSearchLevel !== undefined
          ? { assistantSearchLevel: detail.assistantSearchLevel }
          : {}),
      })
    }
    window.addEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handler)
    return () => window.removeEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handler)
  }, [
    requestMode,
    hasChat,
    canBuild,
    mothershipAvailable,
    organization.id,
    router,
    sendMessage,
    setSearchParams,
  ])
  const { mutate: markRead } = useMarkMothershipChatRead({ organizationId: organization.id })
  const firstName = userName?.split(' ')[0] ?? ''

  useEffect(() => {
    if (chat.resolvedChatId && !chat.isSending && !chat.isReconnecting)
      markRead(chat.resolvedChatId)
  }, [chat.resolvedChatId, chat.isSending, chat.isReconnecting, markRead])

  useEffect(() => {
    if (chatId) return
    const handoff = MothershipHandoffStorage.consume(
      { organizationId: organization.id },
      undefined,
      requestMode
    )
    if (handoff && (handoff.message || handoff.fileAttachments?.length)) {
      setSelectedMode(requestMode)
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
  }, [chatId, organization.id, requestMode, sendMessage, assistantSearchLevel, liveSearch])

  const send = (
    message: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[],
    assistantSearch?: WorkspaceSearchFilters
  ) => {
    if (requestMode !== 'assistant' && !canBuild) return
    if (requestMode === 'assistant') recordQuery(message)
    setSelectedMode(requestMode)
    if (requestMode !== 'assistant') panel.prepareResourceViewForAgentTurn()
    void sendMessage(message, fileAttachments, contexts, {
      requestMode,
      ...(requestMode === 'assistant' ? { assistantSearchLevel } : {}),
      ...(assistantSearch ? { assistantSearch } : {}),
    })
  }
  const changeMode = (mode: ChatRequestMode) => {
    if (!canSelectMode || (mode === requestMode && !lookupMode)) return
    setSelectedMode(mode)
    void setSearchParams({ searchLevel: null, mode, q: null })
    if (userId) rememberMode(userId, organization.id, mode)
  }

  const submit = (text: string, contexts?: ChatContext[]) => {
    const message = text.trim()
    if (lookupMode) {
      if (!message) return
      recordQuery(message)
      setDraft(message)
      void setSearchParams({ q: message })
      return
    }
    if (files.attachedFiles.some((file) => file.uploading)) return
    const attachments: FileAttachmentForApi[] = files.attachedFiles
      .filter((file) => file.key)
      .map((file) => ({
        id: file.id,
        key: file.key!,
        filename: file.name,
        media_type: file.type,
        size: file.size,
        path: file.path,
      }))
    if (!message && !attachments.length) return
    if (!hasChat && message && onBeforeSend?.(message, requestMode)) {
      useMothershipDraftsStore.getState().clearDraft(draftKey)
      files.clearAttachedFiles()
      return
    }
    useMothershipDraftsStore.getState().clearDraft(draftKey)
    send(message, attachments.length ? attachments : undefined, contexts)
    setRestoredContexts([])
    files.clearAttachedFiles()
  }

  const composer =
    requestMode !== 'assistant' && !canBuild ? (
      <div className='px-4 py-3 text-[var(--text-muted)] text-sm'>
        Build requires permission to create workspaces.{' '}
        {searchAccess.memberScoped && (
          <Link href={`/o/${organization.id}/home`} className='underline'>
            Ask about your sources
          </Link>
        )}
      </div>
    ) : (
      <Composer
        requestMode={requestMode}
        lookupMode={lookupMode}
        onSearchMode={
          projectViewEnabled && canSelectMode
            ? () => void setSearchParams({ mode: 'search', searchLevel: null })
            : undefined
        }
        searchEnabled={searchAccess.memberScoped}
        showModeSelector={canSelectMode}
        onModeChange={canSelectMode ? changeMode : undefined}
        value={draft}
        restoredContexts={restoredContexts}
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

  const hostLanding = hasChat ? undefined : landing?.(requestMode)
  const content = (
    <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)]'>
      {projectViewEnabled && (
        <header className='flex h-[calc(var(--resource-header-controls-height)+1px)] shrink-0 items-center gap-2 border-[var(--border)] border-b px-4'>
          <OverflowText
            label={chatTitle || (lookupMode ? 'Search' : 'New chat')}
            className='text-[var(--text-body)] text-small'
          />
        </header>
      )}
      {lookupMode ? (
        <SearchResultsView
          embedded
          composer={composer}
          query={q}
          onSummarize={(message, filters) => {
            setSelectedMode('assistant')
            void setSearchParams({ mode: 'assistant', q: null })
            void sendMessage(message, undefined, undefined, {
              requestMode: 'assistant',
              assistantSearchLevel,
              assistantSearch: filters,
            })
          }}
        />
      ) : (
        <>
          {hasChat ? (
            <MothershipChat
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
              onEditQueuedMessage={(id) => {
                const queued = chat.editQueuedMessage(id)
                if (queued) {
                  const queuedMode = queued.requestMode ?? requestMode
                  setSelectedMode(queuedMode)
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
              }}
              onCancelQueueEdit={chat.cancelQueueEdit}
              userId={session?.user?.id}
              chatId={chat.resolvedChatId}
              composer={composer}
              onWorkspaceResourceSelect={requestMode !== 'assistant' ? selectResource : undefined}
              initialScrollBlocked={
                (requestMode !== 'assistant' || liveSearch) &&
                chat.resources.length > 0 &&
                panel.isResourceCollapsed
              }
            />
          ) : (
            <OrganizationLanding
              heading={
                hostLanding?.heading ??
                (requestMode === 'assistant'
                  ? projectViewEnabled
                    ? 'What would you like to know?'
                    : `Search ${organization.name}`
                  : requestMode === 'plan'
                    ? `What should we understand and plan${firstName ? `, ${firstName}` : ''}?`
                    : `What should we get done${firstName ? `, ${firstName}` : ''}?`)
              }
            >
              {hostLanding?.accessory}
              {composer}
              <div className='absolute inset-x-0 top-full'>
                {requestMode === 'agent' ? (
                  <SuggestedActions
                    organizationId={organization.id}
                    onSelectPrompt={(prompt) => setDraft(mentionifyIntegrations(prompt))}
                  />
                ) : searchAccess.memberScoped ? (
                  <GetStarted />
                ) : null}
              </div>
            </OrganizationLanding>
          )}
        </>
      )}
    </div>
  )
  return (
    <ChatResourcePanel
      navigation={projectViewEnabled ? projectPane.navigation : undefined}
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

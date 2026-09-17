'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import { requestJson } from '@/lib/api/client/request'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { getWorkspaceHostContextContract } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { getMothershipAttachmentPreviewUrl } from '@/lib/mothership/chat/attachment-preview'
import { createSearchResource } from '@/lib/mothership/resources/search'
import { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { GetStarted } from '@/app/o/[organizationId]/home/components/get-started'
import {
  organizationHomeParsers,
  type SearchLevel,
} from '@/app/o/[organizationId]/home/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { organizationSearchUrlKeys } from '@/app/o/[organizationId]/search/search-params'
import { ChatResourcePanel } from '@/app/workspace/[workspaceId]/home/components/chat-resource-panel'
import { SearchIntegrationConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat'
import { SuggestedActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
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
import { useFileAttachments } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { mentionifyIntegrations } from '@/blocks/integration-matcher'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'
import { getWorkspaceFilesQueryOptions } from '@/hooks/queries/workspace-files'
import { useOrganizationChatModeStore } from '@/stores/organization-chat-mode/store'
import type { ChatContext } from '@/stores/panel'

interface OrganizationHomeProps {
  userName?: string
  chatId?: string
  requestMode?: ChatRequestMode
}

const subscribeToClient = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/** Home chooses the next turn harness while keeping the current conversation intact. */
export function OrganizationHome(props: OrganizationHomeProps) {
  const { organization, searchAccess, canBuild, mothershipAvailable } = useOrganizationContext()
  const { data: session } = useSession()
  const isClient = useSyncExternalStore(subscribeToClient, clientSnapshot, serverSnapshot)
  if (!mothershipAvailable || (!canBuild && !searchAccess.memberScoped)) return null
  /** Preferences are browser-persisted and keyed by user; never paint a guessed mode first. */
  if (!isClient || !session?.user?.id) return <HomeFallback />
  return <OrganizationHomeContent key={`${organization.id}:${props.chatId ?? 'new'}`} {...props} />
}

function OrganizationHomeContent({
  userName,
  chatId,
  requestMode: savedMode,
}: OrganizationHomeProps) {
  const { organization, searchAccess, canBuild, mothershipAvailable } = useOrganizationContext()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const rememberedMode = useOrganizationChatModeStore(
    (state) => state.modes[`${userId}:${organization.id}`]
  )
  const rememberedSearchLevel = useOrganizationChatModeStore(
    (state) => state.assistantSearchLevels?.[`${userId}:${organization.id}`] ?? 'adaptive'
  )
  const rememberAssistantSearchLevel = useOrganizationChatModeStore(
    (state) => state.setAssistantSearchLevel
  )
  const [{ q, source, updated, searchLevel: urlSearchLevel }, setSearchParams] = useQueryStates(
    organizationHomeParsers,
    organizationSearchUrlKeys
  )
  const rememberMode = useOrganizationChatModeStore((state) => state.setMode)
  const [selectedMode, setSelectedMode] = useState<ChatRequestMode | null>(null)
  const requestMode =
    selectedMode ??
    (urlSearchLevel && searchAccess.memberScoped && !chatId ? 'assistant' : undefined) ??
    savedMode ??
    (!canBuild || !mothershipAvailable
      ? 'assistant'
      : rememberedMode === 'assistant' && searchAccess.memberScoped
        ? 'assistant'
        : 'agent')
  const [draft, setDraft] = useState('')
  const [restoredContexts, setRestoredContexts] = useState<ChatContext[]>([])
  const controller = useResourcePanelController()
  const queryClient = useQueryClient()
  const chat = useChat({ organizationId: organization.id }, chatId, {
    requestMode,
    projectsDesktopTabs: requestMode === 'agent',
    onResourceEvent: controller.onResourceEvent,
    activeResourceState: controller.activeResourceState,
  })
  const hasChat = Boolean(chatId || chat.messages.length)
  const assistantSearchLevel = urlSearchLevel ?? rememberedSearchLevel
  const panel = useChatResourcePanel(chat, controller)
  const addResource = panel.addResourceFromUser
  /** Restore only an explicitly selected results tab on an empty Home; closing it clears the URL. */
  useEffect(() => {
    if (hasChat || !q.trim()) return
    const resource = createSearchResource({
      scope: { kind: 'organization', organizationId: organization.id },
      query: q.trim(),
      filters: searchFiltersFromParams({ source, updated }, Date.now()),
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
    organization.id,
    controller.activeResourceParam,
    chat.resources,
    addResource,
  ])
  const changeAssistantSearchLevel = (level: SearchLevel) => {
    if (userId) {
      rememberAssistantSearchLevel(userId, organization.id, level)
      rememberMode(userId, organization.id, 'assistant')
    }
    void setSearchParams({ searchLevel: level })
  }
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
  })
  useEffect(() => {
    if (chat.error) toast.error(chat.error)
  }, [chat.error])
  const { sendMessage } = chat
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
              assistantSearchLevel: handoff.assistantSearchLevel ?? assistantSearchLevel,
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
    if (requestMode === 'agent' && !canBuild) return
    setSelectedMode(requestMode)
    if (requestMode === 'agent') panel.prepareResourceViewForAgentTurn()
    void sendMessage(message, fileAttachments, contexts, {
      requestMode,
      ...(requestMode === 'assistant' ? { assistantSearchLevel } : {}),
      ...(assistantSearch ? { assistantSearch } : {}),
    })
  }
  const changeMode = (mode: ChatRequestMode) => {
    if (!canBuild || !searchAccess.memberScoped || mode === requestMode) return
    setSelectedMode(mode)
    void setSearchParams({ searchLevel: null })
    if (userId) rememberMode(userId, organization.id, mode)
  }

  const submit = (text: string, contexts?: ChatContext[]) => {
    const message = text.trim()
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
    setDraft('')
    send(message, attachments.length ? attachments : undefined, contexts)
    setRestoredContexts([])
    files.clearAttachedFiles()
  }

  const composer =
    requestMode === 'agent' && !canBuild ? (
      <div className='px-4 py-3 text-[var(--text-muted)] text-sm'>
        Build requires permission to create workspaces.{' '}
        {searchAccess.memberScoped && (
          <Link href={`/o/${organization.id}/home`} className='underline'>
            Start a Search chat
          </Link>
        )}
      </div>
    ) : (
      <Composer
        requestMode={requestMode}
        assistantSearchLevel={assistantSearchLevel}
        onAssistantSearchLevelChange={changeAssistantSearchLevel}
        showModeSelector={mothershipAvailable && canBuild && searchAccess.memberScoped}
        onModeChange={changeMode}
        value={draft}
        restoredContexts={restoredContexts}
        files={files}
        isInitialView={!hasChat}
        isSending={chat.isSending || chat.isReconnecting}
        onChange={setDraft}
        onSubmit={submit}
        onStop={() => {
          void chat.stopGeneration()
        }}
      />
    )

  const content = (
    <div className='flex h-full min-h-0 min-w-[240px] flex-1 flex-col bg-[var(--bg)]'>
      {hasChat ? (
        <MothershipChat
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
              setDraft(queued.content)
              if (queuedMode === 'assistant')
                changeAssistantSearchLevel(queued.assistantSearchLevel ?? 'adaptive')
              setRestoredContexts(queued.contexts ?? [])
              files.restoreAttachedFiles(
                (queued.fileAttachments ?? []).map((file) => ({
                  id: file.id,
                  key: file.key,
                  name: file.filename,
                  type: file.media_type,
                  size: file.size,
                  path: file.path || getMothershipAttachmentPreviewUrl(file) || '',
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
          onWorkspaceResourceSelect={requestMode === 'agent' ? selectResource : undefined}
          initialScrollBlocked={
            requestMode === 'agent' && chat.resources.length > 0 && panel.isResourceCollapsed
          }
        />
      ) : (
        <div className='min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
          {/* Asymmetric padding biases the group up so the full cluster (heading + input + steps) sits at the optical center */}
          <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
            <h1 className='mb-7 max-w-chat text-balance font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
              {requestMode === 'assistant'
                ? `Search ${organization.name}`
                : `What should we get done${firstName ? `, ${firstName}` : ''}?`}
            </h1>
            <div className='relative w-full max-w-chat'>
              {composer}
              {/* Anchored out of flow so expanding/collapsing never shifts the centered input */}
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
  return (
    <ChatResourcePanel
      allowBuildControls={requestMode === 'agent' && canBuild}
      organizationId={organization.id}
      chat={chat}
      panel={panel}
      onSummarize={(message, filters) => send(message, undefined, undefined, filters)}
    >
      {content}
    </ChatResourcePanel>
  )
}

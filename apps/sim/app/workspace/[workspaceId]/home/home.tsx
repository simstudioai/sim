'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { requestJson } from '@/lib/api/client/request'
import { createWorkflowContract } from '@/lib/api/contracts'
import {
  LandingPromptStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
  MothershipHandoffStorage,
} from '@/lib/core/utils/browser-storage'
import {
  addMothershipContexts,
  MOTHERSHIP_SEND_MESSAGE_EVENT,
  type MothershipSendMessageDetail,
} from '@/lib/mothership/events'
import { captureEvent } from '@/lib/posthog/client'
import { persistImportedWorkflow } from '@/lib/workflows/operations/import-export'
import { ChatResourcePanel } from '@/app/workspace/[workspaceId]/home/components/chat-resource-panel'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { SuggestedActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions'
import {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/app/workspace/[workspaceId]/home/hooks/use-resource-panel'
import { resolveWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'
import { getWorkspaceFilesQueryOptions, useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import type { ChatContext } from '@/stores/panel'
import {
  ChatSurfaceProvider,
  CreditsChip,
  MothershipChat,
  UserInput,
  type UserInputHandle,
} from './components'
import { getMothershipUseChatOptions, useChat } from './hooks'
import type {
  FileAttachmentForApi,
  MothershipResource,
  MothershipResourceType,
  WorkspaceResourceRef,
} from './types'

const logger = createLogger('Home')

interface HomeProps {
  chatId?: string
  userName?: string
  userId?: string
}

export function Home(props: HomeProps) {
  return (
    <PermissionAccessBoundary configKey='hideCopilot'>
      <HomeContent {...props} />
    </PermissionAccessBoundary>
  )
}

function HomeContent({ chatId, userName, userId }: HomeProps) {
  useOAuthReturnRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const queryClient = useQueryClient()
  const controller = useResourcePanelController()
  const firstName = userName?.split(' ')[0] ?? ''
  const { data: workspaceFiles = [] } = useWorkspaceFiles(workspaceId)
  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog
  const [selectedMode, setSelectedMode] = useState<'agent' | 'plan'>('agent')
  const [initialPrompt, setInitialPrompt] = useState('')
  const hasCheckedLandingStorageRef = useRef(false)
  const initialViewInputRef = useRef<HTMLDivElement>(null)
  const initialViewUserInputRef = useRef<UserInputHandle>(null)

  const [isInputEntering, setIsInputEntering] = useState(false)

  const createWorkflowFromLandingSeed = useCallback(
    async (seed: LandingWorkflowSeed) => {
      try {
        const result = await persistImportedWorkflow({
          content: seed.workflowJson,
          filename: `${seed.workflowName}.json`,
          workspaceId,
          nameOverride: seed.workflowName,
          descriptionOverride: seed.workflowDescription || undefined,
          createWorkflow: async ({ name, description, workspaceId }) => {
            return requestJson(createWorkflowContract, {
              body: {
                name,
                description,
                workspaceId,
                deduplicate: true,
              },
            })
          },
        })

        if (result?.workflowId) {
          window.location.href = `/workspace/${workspaceId}/w/${result.workflowId}`
          return
        }

        logger.warn('Landing workflow seed did not produce a workflow', {
          templateId: seed.templateId,
        })
      } catch (error) {
        logger.error('Error creating workflow from landing workflow seed:', error)
      }
    },
    [workspaceId]
  )

  useEffect(() => {
    if (hasCheckedLandingStorageRef.current) return
    hasCheckedLandingStorageRef.current = true

    const workflowSeed = LandingWorkflowSeedStorage.consume()
    if (workflowSeed) {
      logger.info('Retrieved landing page workflow seed, creating workflow in workspace')
      void createWorkflowFromLandingSeed(workflowSeed)
      return
    }

    const prompt = LandingPromptStorage.consume()
    if (prompt) {
      logger.info('Retrieved landing page prompt, populating home input')
      setInitialPrompt(prompt)
    }
  }, [createWorkflowFromLandingSeed])

  const wasSendingRef = useRef(false)

  const { mutate: markRead } = useMarkMothershipChatRead(workspaceId)

  const chat = useChat(
    workspaceId,
    chatId,
    getMothershipUseChatOptions({
      ...(!chatId ? { requestMode: selectedMode } : {}),
      onResourceEvent: controller.onResourceEvent,
      activeResourceState: controller.activeResourceState,
      onRequestStarted: ({ requestId, userMessageId }) => {
        captureEvent(posthogRef.current, 'task_request_started', {
          workspace_id: workspaceId,
          view: 'mothership',
          request_id: requestId,
          user_message_id: userMessageId,
        })
      },
    })
  )

  const {
    messages,
    isChatHistoryPending,
    isSending,
    isReconnecting,
    sendMessage,
    stopGeneration,
    resolvedChatId,
    resources,
    removeResource,
    messageQueue,
    removeFromQueue,
    sendNow,
    editQueuedMessage,
    cancelQueueEdit,
    editingQueuedId,
    dispatchingHeadId,
    getCurrentRequestId,
  } = chat
  const panel = useChatResourcePanel(chat, controller)
  const {
    isResourceCollapsed,
    skipResourceTransition,
    addResourceFromUser,
    prepareResourceViewForAgentTurn,
  } = panel

  useEffect(() => {
    wasSendingRef.current = false
    if (resolvedChatId) markRead(resolvedChatId)
  }, [resolvedChatId, markRead])
  useEffect(() => {
    if (wasSendingRef.current && !isSending && resolvedChatId) markRead(resolvedChatId)
    wasSendingRef.current = isSending
  }, [isSending, resolvedChatId, markRead])

  const handleStopGeneration = useCallback(() => {
    captureEvent(posthogRef.current, 'task_generation_aborted', {
      workspace_id: workspaceId,
      view: 'mothership',
      request_id: getCurrentRequestId(),
    })
    void stopGeneration().catch(() => {})
  }, [workspaceId, getCurrentRequestId, stopGeneration])

  const handleSubmit = useCallback(
    async (text: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
      const trimmed = text.trim()
      if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return

      captureEvent(posthogRef.current, 'task_message_sent', {
        workspace_id: workspaceId,
        has_attachments: !!(fileAttachments && fileAttachments.length > 0),
        has_contexts: !!(contexts && contexts.length > 0),
        is_new_task: !chatId,
      })

      if (initialViewInputRef.current) {
        setIsInputEntering(true)
      }

      prepareResourceViewForAgentTurn()
      sendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments, contexts)
    },
    [workspaceId, chatId, prepareResourceViewForAgentTurn, sendMessage]
  )

  /**
   * Handles cross-surface send requests (terminal/console "Fix in Chat", the
   * log "Troubleshoot in Chat" action). `preventDefault` claims the event so a
   * producer that dispatched it while this chat is mounted knows a live chat
   * consumed the message and skips its navigate-and-persist fallback.
   */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<MothershipSendMessageDetail>).detail
      if (!detail?.message) return
      e.preventDefault()
      prepareResourceViewForAgentTurn()
      sendMessage(detail.message, detail.fileAttachments, detail.contexts, {
        ...(detail.resumeUserMessageId ? { resumeUserMessageId: detail.resumeUserMessageId } : {}),
        ...(detail.requestMode ? { requestMode: detail.requestMode } : {}),
        ...(detail.assistantSearch ? { assistantSearch: detail.assistantSearch } : {}),
        ...(detail.assistantSearchLevel !== undefined
          ? { assistantSearchLevel: detail.assistantSearchLevel }
          : {}),
      })
    }
    window.addEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handler)
    return () => window.removeEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handler)
  }, [prepareResourceViewForAgentTurn, sendMessage])

  /**
   * Consumes a one-shot handoff left by another surface and applies it to this
   * fresh chat. Two shapes arrive here: a message handoff (e.g. "Troubleshoot in
   * Chat" on an errored log) is auto-sent with its contexts attached; a
   * chip-only handoff (highlight-to-chat from the standalone Files/Tables pages)
   * seeds reference chips and sends nothing.
   *
   * Only the cross-route path lands here — when a chat is already mounted the
   * events deliver directly. Gated to the new-chat surface (`!chatId`): a
   * handoff always targets a fresh chat, so an existing `/chat/[chatId]` mount
   * must never claim it if navigation races. `consume` clears the entry
   * atomically, so it fires at most once even across a StrictMode remount.
   *
   * Chip-only handoffs open each resource directly rather than relying on the
   * input's listener being mounted, then dispatch so the input inserts the chip.
   * This effect is declared after `useChat`, so its chat-init `setResources([])`
   * has already flushed and cannot wipe the just-opened resource.
   */
  useEffect(() => {
    if (chatId) return
    const handoff = MothershipHandoffStorage.consume(workspaceId)
    if (!handoff) return
    if (handoff.message) {
      prepareResourceViewForAgentTurn()
      sendMessage(handoff.message, handoff.fileAttachments, handoff.contexts, {
        ...(handoff.resumeUserMessageId
          ? { resumeUserMessageId: handoff.resumeUserMessageId }
          : {}),
        ...(handoff.requestMode ? { requestMode: handoff.requestMode } : {}),
        ...(handoff.assistantSearch ? { assistantSearch: handoff.assistantSearch } : {}),
        ...(handoff.assistantSearchLevel !== undefined
          ? { assistantSearchLevel: handoff.assistantSearchLevel }
          : {}),
      })
      return
    }
    const contexts = handoff.contexts ?? []
    for (const context of contexts) handleContextAdd(context)
    addMothershipContexts(contexts)
    // `handleContextAdd` is a body function, so it is a new value every render;
    // listing it would re-run this drain on every render. Omitted deliberately to
    // keep it one-shot — and harmless either way, since `consume` clears the entry
    // atomically and any re-run would find nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [chatId, workspaceId, prepareResourceViewForAgentTurn, sendMessage])

  function resolveResourceFromContext(
    context: ChatContext
  ): { type: MothershipResourceType; id: string } | null {
    switch (context.kind) {
      case 'workflow':
      case 'current_workflow':
        return context.workflowId ? { type: 'workflow', id: context.workflowId } : null
      case 'knowledge':
        return context.knowledgeId ? { type: 'knowledgebase', id: context.knowledgeId } : null
      case 'table':
        return context.tableId ? { type: 'table', id: context.tableId } : null
      case 'table_selection':
        return context.tableId ? { type: 'table', id: context.tableId } : null
      case 'file':
        return context.fileId ? { type: 'file', id: context.fileId } : null
      case 'file_selection':
        return context.fileId ? { type: 'file', id: context.fileId } : null
      default:
        return null
    }
  }

  /**
   * Tab title for the resource a chip opens. A selection chip's label describes
   * the selection (`notes.md:12-40`, `Sales (3 rows)`) but the tab shows the
   * whole file/table, so title it from the resource name the context carries.
   */
  function resourceTitleForContext(context: ChatContext): string {
    if (context.kind === 'file_selection') return context.fileName
    if (context.kind === 'table_selection') return context.tableName
    return context.label
  }

  function handleContextAdd(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (resolved) {
      addResourceFromUser({ ...resolved, title: resourceTitleForContext(context) })
    }
  }

  function handleInitialContextRemove(context: ChatContext, remaining: ChatContext[]) {
    const resolved = resolveResourceFromContext(context)
    if (!resolved) return
    // A whole-file chip and one or more of its selection chips (or several
    // selections of the same file/table) all resolve to the same resource tab.
    // Only close the tab once no remaining chip still references it, so removing
    // one of several chips doesn't yank a slideover the others still point at.
    const stillReferenced = remaining.some((other) => {
      const otherResolved = resolveResourceFromContext(other)
      return otherResolved?.type === resolved.type && otherResolved.id === resolved.id
    })
    if (stillReferenced) return
    removeResource(resolved.type, resolved.id)
  }

  function openWorkspaceResource(resource: MothershipResource) {
    addResourceFromUser(resource)
  }

  /**
   * Opens the resource a message chip points at, resolving it first. A chip may
   * carry only a filename — the agent names a file before the client's file
   * list knows it exists — so one forced refetch closes that window. What still
   * resolves to nothing opens nothing, rather than a tab that cannot be
   * viewed or removed.
   */
  async function handleWorkspaceResourceSelect(ref: WorkspaceResourceRef) {
    const immediate = resolveWorkspaceResourceRef(ref, workspaceFiles)
    if (immediate) {
      openWorkspaceResource(immediate)
      return
    }
    if (ref.type !== 'file') return

    // `staleTime: 0` forces the fetch this branch exists for — the cached list
    // is what already failed to resolve. `fetchQuery` rejects on error and this
    // handler is invoked as a void callback, so failure becomes null rather
    // than an unhandled rejection — and stays distinct from an empty list, so
    // "we could not look" is never reported as "it is not there".
    const files = await queryClient
      .fetchQuery({ ...getWorkspaceFilesQueryOptions(workspaceId), staleTime: 0 })
      .catch(() => null)
    const resolved = files && resolveWorkspaceResourceRef(ref, files)
    if (resolved) {
      openWorkspaceResource(resolved)
      return
    }
    // The chip looks clickable, so refusing silently reads as a broken button.
    toast.error(
      files
        ? `Couldn't find "${ref.title}" in this workspace`
        : `Couldn't open "${ref.title}" — check your connection and try again`
    )
    logger.warn('Ignored a resource chip that did not resolve', {
      type: ref.type,
      title: ref.title,
      hasPath: Boolean(ref.path),
      reachedWorkspace: files !== null,
    })
  }

  const hasMessages = messages.length > 0
  const showChatSkeleton = Boolean(chatId) && !hasMessages && isChatHistoryPending
  const draftScopeKey = `${workspaceId}:${chatId ?? 'new'}`

  // The empty state is the chat pane's content, not a layout of its own. It
  // used to return early, which meant the resource panel and its toggle did
  // not exist until the first message — so there was no way to open a resource
  // while composing the very prompt that needed one.
  const showEmptyState = !hasMessages && !showChatSkeleton

  return (
    <ChatResourcePanel workspaceId={workspaceId} chat={chat} panel={panel}>
      <div className='relative flex h-full min-w-[240px] flex-1 flex-col'>
        {showEmptyState && (
          <div
            className={cn(
              'z-10',
              RESOURCE_HEADER_CLASSES.overlay,
              // Collapsed, the expand toggle overlays this corner, so the chip
              // yields the fixed reserve; open, the toggle lives in the panel's
              // corner and the chip takes the standard end inset itself.
              isResourceCollapsed
                ? RESOURCE_HEADER_CLASSES.adjacentEndPosition
                : RESOURCE_HEADER_CLASSES.endPosition,
              skipResourceTransition
                ? 'transition-none'
                : 'transition-[right] duration-200 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]'
            )}
          >
            <CreditsChip />
          </div>
        )}
        {showEmptyState ? (
          <div className='h-full overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
            {/* Asymmetric padding biases the group up so the full cluster (heading + input + suggestions) sits at the optical center */}
            <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
              <h1 className='mb-7 max-w-chat text-balance font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
                What should we get done{firstName ? `, ${firstName}` : ''}?
              </h1>
              <div ref={initialViewInputRef} className='relative w-full max-w-chat'>
                <ChatSurfaceProvider
                  userId={userId}
                  onContextAdd={handleContextAdd}
                  onContextRemove={handleInitialContextRemove}
                >
                  <UserInput
                    ref={initialViewUserInputRef}
                    requestMode={selectedMode}
                    onModeChange={setSelectedMode}
                    defaultValue={initialPrompt}
                    draftScopeKey={draftScopeKey}
                    onSubmit={handleSubmit}
                    isSending={isSending}
                    onStopGeneration={handleStopGeneration}
                  />
                </ChatSurfaceProvider>
                {/* Anchored out of flow so expanding/collapsing never shifts the centered input */}
                <div className='absolute inset-x-0 top-full'>
                  <SuggestedActions
                    onSelectPrompt={(prompt) =>
                      initialViewUserInputRef.current?.populatePrompt(prompt)
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <MothershipChat
            workspaceId={workspaceId}
            messages={messages}
            isSending={isSending}
            isReconnecting={isReconnecting}
            isLoading={showChatSkeleton}
            onSubmit={handleSubmit}
            onStopGeneration={handleStopGeneration}
            messageQueue={messageQueue}
            editingQueuedId={editingQueuedId}
            dispatchingHeadId={dispatchingHeadId}
            onRemoveQueuedMessage={removeFromQueue}
            onSendQueuedMessage={sendNow}
            onEditQueuedMessage={editQueuedMessage}
            onCancelQueueEdit={cancelQueueEdit}
            userId={userId}
            chatId={resolvedChatId}
            onContextAdd={handleContextAdd}
            onWorkspaceResourceSelect={handleWorkspaceResourceSelect}
            draftScopeKey={draftScopeKey}
            animateInput={isInputEntering}
            onInputAnimationEnd={isInputEntering ? () => setIsInputEntering(false) : undefined}
            initialScrollBlocked={resources.length > 0 && isResourceCollapsed}
          />
        )}
      </div>
    </ChatResourcePanel>
  )
}

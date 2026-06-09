'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { requestJson } from '@/lib/api/client/request'
import { createWorkflowContract } from '@/lib/api/contracts'
import {
  LandingPromptStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
} from '@/lib/core/utils/browser-storage'
import { cn } from '@/lib/core/utils/cn'
import {
  MOTHERSHIP_SEND_MESSAGE_EVENT,
  type MothershipSendMessageDetail,
} from '@/lib/mothership/events'
import { captureEvent } from '@/lib/posthog/client'
import { persistImportedWorkflow } from '@/lib/workflows/operations/import-export'
import { ChatSwitcher } from '@/app/workspace/[workspaceId]/components/chat-switcher'
import { SidebarToggle } from '@/app/workspace/[workspaceId]/components/sidebar-toggle'
import {
  useMarkMothershipChatRead,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import type { ChatContext } from '@/stores/panel'
import {
  ChatHistory,
  CreditsChip,
  MothershipChat,
  MothershipView,
  SuggestedActions,
  UserInput,
  type UserInputHandle,
} from './components'
import { ChatTitleBar } from './components/mothership-chat/components/chat-title-bar'
import { ResourcePanelToggle } from './components/mothership-view/components/resource-tabs/resource-panel-toggle'
import { getMothershipUseChatOptions, useChat, useMothershipResize } from './hooks'
import type { FileAttachmentForApi, MothershipResource, MothershipResourceType } from './types'

const logger = createLogger('Home')

interface HomeProps {
  chatId?: string
  userName?: string
  userId?: string
  initialResourceId?: string | null
}

export function Home({ chatId, userName, userId, initialResourceId = null }: HomeProps) {
  useOAuthReturnRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const firstName = userName?.split(' ')[0] ?? ''
  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog
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
          descriptionOverride: seed.workflowDescription || 'Imported from landing template',
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

  const { isPending: isChatHistoryPending } = useMothershipChatHistory(chatId)
  const { mutate: markRead } = useMarkMothershipChatRead(workspaceId)

  const { mothershipRef, handleResizePointerDown, clearWidth } = useMothershipResize()

  const [isResourceCollapsed, setIsResourceCollapsed] = useState(true)
  const [skipResourceTransition, setSkipResourceTransition] = useState(false)
  const isResourceCollapsedRef = useRef(isResourceCollapsed)
  isResourceCollapsedRef.current = isResourceCollapsed

  const collapseResource = useCallback(() => {
    clearWidth()
    setIsResourceCollapsed(true)
  }, [clearWidth])

  const [isChatCollapsed, setIsChatCollapsed] = useState(false)

  const closeChatPane = useCallback(() => {
    clearWidth()
    setIsChatCollapsed(true)
  }, [clearWidth])

  const reopenChatPane = useCallback(() => setIsChatCollapsed(false), [])

  function handleResourceEvent() {
    if (isResourceCollapsedRef.current) {
      setIsResourceCollapsed(false)
    }
  }

  const {
    messages,
    isSending,
    isReconnecting,
    sendMessage,
    stopGeneration,
    resolvedChatId,
    adoptResolvedChatId,
    resources,
    activeResourceId,
    setActiveResourceId,
    addResource,
    removeResource,
    reorderResources,
    messageQueue,
    removeFromQueue,
    sendNow,
    editQueuedMessage,
    cancelQueueEdit,
    editingQueuedId,
    dispatchingHeadId,
    previewSession,
    genericResourceData,
    getCurrentRequestId,
  } = useChat(
    workspaceId,
    chatId,
    getMothershipUseChatOptions({
      onResourceEvent: handleResourceEvent,
      initialActiveResourceId: initialResourceId,
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

  useEffect(() => {
    const url = new URL(window.location.href)
    if (activeResourceId) {
      url.searchParams.set('resource', activeResourceId)
    } else {
      url.searchParams.delete('resource')
    }
    url.hash = ''
    window.history.replaceState(null, '', url.toString())
  }, [activeResourceId])

  useEffect(() => {
    wasSendingRef.current = false
    if (resolvedChatId) {
      markRead(resolvedChatId)
    } else {
      clearWidth()
      setIsResourceCollapsed(true)
    }
  }, [resolvedChatId, markRead, clearWidth])

  useEffect(() => {
    if (wasSendingRef.current && !isSending && resolvedChatId) {
      markRead(resolvedChatId)
    }
    wasSendingRef.current = isSending
  }, [isSending, resolvedChatId, markRead])

  useEffect(() => {
    if (!(resources.length > 0 && isResourceCollapsedRef.current)) return
    setIsResourceCollapsed(false)
    setSkipResourceTransition(true)
    const id = requestAnimationFrame(() => setSkipResourceTransition(false))
    return () => cancelAnimationFrame(id)
  }, [resources])

  useEffect(() => {
    if (resources.length === 0 && !isResourceCollapsedRef.current) {
      collapseResource()
    }
  }, [resources, collapseResource])

  function handleStopGeneration() {
    captureEvent(posthogRef.current, 'task_generation_aborted', {
      workspace_id: workspaceId,
      view: 'mothership',
      request_id: getCurrentRequestId(),
    })
    void stopGeneration().catch(() => {})
  }

  function handleSubmit(
    text: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) {
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

    sendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments, contexts)
  }

  /**
   * Opens an existing chat from the All Chats list WITHOUT navigating. Adopting
   * the chat id repoints `useChat` at its history (so messages hydrate in place)
   * and rewrites the URL to /task/[id] via replaceState; flipping
   * `isInputEntering` plays the same slide-in morph as sending a new message.
   */
  const handleOpenExistingChat = useCallback(
    (selectedChatId: string) => {
      captureEvent(posthogRef.current, 'task_opened_from_history', {
        workspace_id: workspaceId,
        chat_id: selectedChatId,
      })
      setIsInputEntering(true)
      adoptResolvedChatId(selectedChatId, { replaceHomeHistory: true })
    },
    [adoptResolvedChatId, workspaceId]
  )

  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<MothershipSendMessageDetail>).detail?.message
      if (message) sendMessage(message)
    }
    window.addEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handler)
    return () => window.removeEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handler)
  }, [sendMessage])

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
      case 'file':
        return context.fileId ? { type: 'file', id: context.fileId } : null
      default:
        return null
    }
  }

  function handleContextAdd(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (resolved) {
      addResource({ ...resolved, title: context.label })
      handleResourceEvent()
    }
  }

  function handleInitialContextRemove(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (!resolved) return
    removeResource(resolved.type, resolved.id)
  }

  function handleWorkspaceResourceSelect(resource: MothershipResource) {
    const wasAdded = addResource(resource)
    if (!wasAdded) {
      setActiveResourceId(resource.id)
    }
    handleResourceEvent()
  }

  // `resolvedChatId` is the chat actually in view — the prop on direct nav, or
  // the id adopted when opening a chat inline from the All Chats list. Gating on
  // it (not just the prop) lets an inline-opened chat render its skeleton + view
  // before its history finishes loading.
  const activeChatId = resolvedChatId ?? chatId
  const { isPending: isActiveChatHistoryPending } = useMothershipChatHistory(activeChatId)
  const hasMessages = messages.length > 0
  const showChatSkeleton = Boolean(activeChatId) && !hasMessages && isActiveChatHistoryPending
  const showChatView = hasMessages || showChatSkeleton || Boolean(resolvedChatId)
  const draftScopeKey = `${workspaceId}:${chatId ?? 'new'}`
  const canCloseChat = resources.length > 0 && !isResourceCollapsed

  // The chat pane can only hide while the resource panel is visible; restore it
  // when the panel collapses or the last resource closes so the view never blanks.
  useEffect(() => {
    if (isChatCollapsed && (resources.length === 0 || isResourceCollapsed)) {
      setIsChatCollapsed(false)
    }
  }, [isChatCollapsed, resources, isResourceCollapsed])

  // Opening a different chat from anywhere (title-bar dropdown, search, deep
  // link) is an explicit "open this chat" — always show its conversation pane.
  useEffect(() => {
    setIsChatCollapsed(false)
  }, [activeChatId])

  if (!showChatView) {
    return (
      <div className='relative flex h-full flex-col bg-[var(--bg)]'>
        <ChatTitleBar />
        <div className='absolute top-[8.5px] right-[16px] z-10'>
          <CreditsChip />
        </div>
        <div className='relative flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
          <div className='flex min-h-full flex-col items-center px-6 pt-[calc(24vh-44px)] pb-[2vh]'>
            <h1 className='mb-7 max-w-[48rem] text-balance font-season text-[30px] text-[var(--text-primary)]'>
              What should we get done{firstName ? `, ${firstName}` : ''}?
            </h1>
            <div ref={initialViewInputRef} className='w-full'>
              {/* Stacked card (Figma node 1-3): grey tray sits behind the input
                with a 1px frame on top/sides. The docked "All Chats" launcher
                lives in the shelf below and animates the chat list open inside
                the grey tray — growing downward as the input rides up. */}
              <div className='mx-auto w-full max-w-[48rem] overflow-hidden rounded-[18px] bg-[var(--surface-3)] p-px'>
                <UserInput
                  ref={initialViewUserInputRef}
                  defaultValue={initialPrompt}
                  draftScopeKey={draftScopeKey}
                  onSubmit={handleSubmit}
                  isSending={isSending}
                  onStopGeneration={handleStopGeneration}
                  userId={userId}
                  onContextAdd={handleContextAdd}
                  onContextRemove={handleInitialContextRemove}
                />
                <ChatHistory onSelectChat={handleOpenExistingChat} />
              </div>
              <SuggestedActions
                onSelectPrompt={(prompt) => initialViewUserInputRef.current?.populatePrompt(prompt)}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='relative flex h-full flex-col bg-[var(--bg)]'>
      <div className='relative flex min-h-0 flex-1'>
        {!isChatCollapsed && (
          <div className='flex h-full min-w-[320px] flex-1 flex-col'>
            <MothershipChat
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
              onCloseChat={canCloseChat ? closeChatPane : undefined}
            />
          </div>
        )}

        {/* Resize handle — zero-width flex child whose absolute child straddles the border */}
        {!isChatCollapsed && !isResourceCollapsed && (
          <div className='relative z-20 w-0 flex-none'>
            <div
              className='absolute inset-y-0 left-[-4px] w-[8px] cursor-ew-resize'
              role='separator'
              aria-orientation='vertical'
              aria-label='Resize resource panel'
              onPointerDown={handleResizePointerDown}
            />
          </div>
        )}

        <MothershipView
          ref={mothershipRef}
          workspaceId={workspaceId}
          chatId={resolvedChatId}
          resources={resources}
          activeResourceId={activeResourceId}
          onSelectResource={setActiveResourceId}
          onAddResource={addResource}
          onRemoveResource={removeResource}
          onReorderResources={reorderResources}
          isCollapsed={isResourceCollapsed}
          previewSession={previewSession}
          genericResourceData={genericResourceData ?? undefined}
          tabsLeading={
            isChatCollapsed ? (
              <>
                {/* With the chat pane hidden, the tabs bar doubles as the title
                    bar: sidebar toggle + compact chat switcher, no second row. */}
                <SidebarToggle className='-ml-[9px]' />
                <ChatSwitcher chatId={activeChatId} onSelectChat={reopenChatPane} />
              </>
            ) : undefined
          }
          className={cn(
            skipResourceTransition && '!transition-none',
            isChatCollapsed && 'w-full flex-1 border-l-0'
          )}
        />
      </div>

      {/* Single, stationary collapse/expand toggle. Lives OUTSIDE the animating
          panel and is always rendered at the fixed top-right corner, overlaying
          the header's spacer when open — so it never moves as the panel slides. */}
      <ResourcePanelToggle
        isCollapsed={isResourceCollapsed}
        onToggle={() => (isResourceCollapsed ? setIsResourceCollapsed(false) : collapseResource())}
        className='absolute top-[7px] right-[7px] z-30'
      />
    </div>
  )
}

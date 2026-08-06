'use client'

import {
  type Dispatch,
  lazy,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Button, cn, toast } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import { requestJson } from '@/lib/api/client/request'
import { createWorkflowContract } from '@/lib/api/contracts'
import {
  LandingPromptStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
  MothershipHandoffStorage,
} from '@/lib/core/utils/browser-storage'
import { isDesktopApp } from '@/lib/desktop'
import {
  addMothershipContexts,
  MOTHERSHIP_SEND_MESSAGE_EVENT,
  type MothershipSendMessageDetail,
} from '@/lib/mothership/events'
import { captureEvent } from '@/lib/posthog/client'
import { persistImportedWorkflow } from '@/lib/workflows/operations/import-export'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { resolveWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'
import { resourceParam, resourceUrlKeys } from '@/app/workspace/[workspaceId]/home/search-params'
import { useFolders } from '@/hooks/queries/folders'
import {
  useMarkMothershipChatRead,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import { useWorkflows } from '@/hooks/queries/workflows'
import { getWorkspaceFilesQueryOptions, useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import type { ChatContext } from '@/stores/panel'
import {
  ChatSurfaceProvider,
  CreditsChip,
  MothershipChat,
  MothershipResourcesProvider,
  SuggestedActions,
  UserInput,
  type UserInputHandle,
} from './components'
import { getMothershipUseChatOptions, useChat, useMothershipResize } from './hooks'
import type {
  FileAttachmentForApi,
  MothershipResource,
  MothershipResourceType,
  WorkspaceResourceRef,
} from './types'

const logger = createLogger('Home')
const subscribeToDesktopApp = () => () => {}
const getServerDesktopAppSnapshot = () => false

/**
 * The resource preview panel pulls in the file-viewer stack (rich-markdown
 * editor, CSV/PDF viewers). It only renders once a chat has messages, so it is
 * code-split out of the initial `/chat` bundle and loaded on demand.
 */
const MothershipView = lazy(() =>
  import('./components/mothership-view/mothership-view').then((m) => ({
    default: m.MothershipView,
  }))
)

interface HomeProps {
  chatId?: string
  userName?: string
  userId?: string
  /** Resolved server-side by the page — the embedded table can't reach AppConfig. */
  tableViewsEnabled?: boolean
}

export function Home({ chatId, userName, userId, tableViewsEnabled }: HomeProps) {
  useOAuthReturnRouter()
  const isDesktop = useSyncExternalStore(
    subscribeToDesktopApp,
    isDesktopApp,
    getServerDesktopAppSnapshot
  )
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  /**
   * URL is the single source of truth for the selected resource. `Home` renders
   * client-side, so nuqs reads `?resource=` from the URL on mount — the same
   * value the page previously threaded through `initialResourceId` — and writes
   * it back with `history: 'replace'`, the previous behavior, minus the banned
   * `window.history.replaceState` param-mutation effect. The page wraps `Home`
   * in Suspense for the `useSearchParams` requirement.
   */
  const [activeResourceParam, setResourceParam] = useQueryState(resourceParam.key, {
    ...resourceParam.parser,
    ...resourceUrlKeys,
  })
  /**
   * Strips any leftover URL fragment on selection change, preserving the old
   * effect's `url.hash = ''` (the only hash usage on this surface) without a
   * separate effect-sync mirror. This rewrites the fragment only — it never
   * mutates a query param via the History API.
   *
   * Order matters: the fragment is stripped synchronously BEFORE the nuqs write,
   * because nuqs re-appends `location.hash` on its (deferred) flush — clearing the
   * hash first ensures the param write doesn't carry the stale fragment back.
   */
  const setActiveResourceUrl = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      if (typeof window !== 'undefined' && window.location.hash) {
        const { pathname, search } = window.location
        window.history.replaceState(window.history.state, '', `${pathname}${search}`)
      }
      void setResourceParam(action)
    },
    [setResourceParam]
  )
  /**
   * Controlled binding handed to `useChat` so the URL is the sole owner of the
   * selection with no dual source.
   */
  const activeResourceState = useMemo<[string | null, Dispatch<SetStateAction<string | null>>]>(
    () => [activeResourceParam, setActiveResourceUrl],
    [activeResourceParam, setActiveResourceUrl]
  )
  const firstName = userName?.split(' ')[0] ?? ''
  const { data: workspaceFiles = [] } = useWorkspaceFiles(workspaceId)
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: folders = [] } = useFolders(workspaceId)
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

  const { isPending: isChatHistoryPending } = useMothershipChatHistory(chatId)
  const { mutate: markRead } = useMarkMothershipChatRead(workspaceId)

  const [isResourceCollapsed, setIsResourceCollapsed] = useState(true)
  const [skipResourceTransition, setSkipResourceTransition] = useState(false)
  const isResourceCollapsedRef = useRef(isResourceCollapsed)
  isResourceCollapsedRef.current = isResourceCollapsed

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
    desktopScopeId,
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
      activeResourceState,
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

  const { mothershipRef, handleResizePointerDown, clearWidth } = useMothershipResize(desktopScopeId)

  const collapseResource = useCallback(() => {
    clearWidth()
    setIsResourceCollapsed(true)
  }, [clearWidth])

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

  const handleStopGeneration = useCallback(() => {
    captureEvent(posthogRef.current, 'task_generation_aborted', {
      workspace_id: workspaceId,
      view: 'mothership',
      request_id: getCurrentRequestId(),
    })
    void stopGeneration().catch(() => {})
  }, [workspaceId, getCurrentRequestId, stopGeneration])

  const handleSubmit = useCallback(
    (text: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
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
    },
    [workspaceId, chatId, sendMessage]
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
      sendMessage(detail.message, undefined, detail.contexts)
    }
    window.addEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handler)
    return () => window.removeEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, handler)
  }, [sendMessage])

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
      sendMessage(handoff.message, undefined, handoff.contexts)
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
  }, [chatId, workspaceId, sendMessage])

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
      addResource({ ...resolved, title: resourceTitleForContext(context) })
      handleResourceEvent()
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
    const wasAdded = addResource(resource)
    if (!wasAdded) {
      setActiveResourceId(resource.id)
    }
    handleResourceEvent()
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
    <div className={cn('relative flex h-full bg-[var(--bg)]', RESOURCE_HEADER_CLASSES.layout)}>
      <div className='relative flex h-full min-w-[240px] flex-1 flex-col'>
        {showEmptyState && (
          <div
            className={cn(
              'absolute z-10',
              RESOURCE_HEADER_CLASSES.contentTop,
              isDesktop || isResourceCollapsed
                ? RESOURCE_HEADER_CLASSES.adjacentEndPosition
                : RESOURCE_HEADER_CLASSES.endPosition
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

      {/* Resize handle — zero-width flex child whose absolute child straddles the border */}
      {!isResourceCollapsed && (
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

      <MothershipResourcesProvider
        selectResource={setActiveResourceId}
        addResource={addResource}
        removeResource={removeResource}
        reorderResources={reorderResources}
        collapseResource={collapseResource}
      >
        <Suspense fallback={null}>
          <MothershipView
            ref={mothershipRef}
            workspaceId={workspaceId}
            chatId={resolvedChatId}
            desktopScopeId={desktopScopeId}
            resources={resources}
            activeResourceId={activeResourceId}
            isCollapsed={isResourceCollapsed}
            useFixedResourceToggle={isDesktop}
            previewSession={previewSession}
            isAgentResponding={isSending}
            genericResourceData={genericResourceData ?? undefined}
            tableViewsEnabled={tableViewsEnabled}
            className={skipResourceTransition ? '!transition-none' : undefined}
          />
        </Suspense>
      </MothershipResourcesProvider>

      {isDesktop ? (
        <div
          className={cn(
            'absolute top-0 z-30 flex items-center',
            RESOURCE_HEADER_CLASSES.controls,
            RESOURCE_HEADER_CLASSES.endPosition
          )}
        >
          <Button
            variant='ghost'
            size={null}
            type='button'
            onClick={isResourceCollapsed ? () => setIsResourceCollapsed(false) : collapseResource}
            className='size-[30px] rounded-[8px] hover-hover:bg-[var(--surface-active)]'
            aria-label={isResourceCollapsed ? 'Expand resource view' : 'Collapse resource view'}
          >
            <PanelLeft className='-scale-x-100 size-[16px] text-[var(--text-icon)]' />
          </Button>
        </div>
      ) : (
        isResourceCollapsed && (
          <div
            className={cn(
              'absolute',
              RESOURCE_HEADER_CLASSES.contentTop,
              RESOURCE_HEADER_CLASSES.endPosition
            )}
          >
            <Button
              variant='ghost'
              size={null}
              type='button'
              onClick={() => setIsResourceCollapsed(false)}
              className='size-[30px] rounded-[8px] hover-hover:bg-[var(--surface-active)]'
              aria-label='Expand resource view'
            >
              <PanelLeft className='size-[16px] text-[var(--text-icon)]' />
            </Button>
          </div>
        )
      )}
    </div>
  )
}

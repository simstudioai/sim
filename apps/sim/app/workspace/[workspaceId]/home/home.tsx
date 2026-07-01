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
} from 'react'
import { Button } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import { requestJson } from '@/lib/api/client/request'
import { createWorkflowContract } from '@/lib/api/contracts'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import {
  buildWorkflowAliasWorkflowEntries,
  resolveWorkflowAliasPath,
  resolveWorkspacePlanAliasPath,
} from '@/lib/copilot/vfs/workflow-aliases'
import {
  LandingPromptStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
  MothershipHandoffStorage,
} from '@/lib/core/utils/browser-storage'
import {
  MOTHERSHIP_SEND_MESSAGE_EVENT,
  type MothershipSendMessageDetail,
} from '@/lib/mothership/events'
import { captureEvent } from '@/lib/posthog/client'
import { persistImportedWorkflow } from '@/lib/workflows/operations/import-export'
import { resourceParam, resourceUrlKeys } from '@/app/workspace/[workspaceId]/home/search-params'
import { useFolders } from '@/hooks/queries/folders'
import {
  useMarkMothershipChatRead,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
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
import type { FileAttachmentForApi, MothershipResource, MothershipResourceType } from './types'

const logger = createLogger('Home')

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
}

export function Home({ chatId, userName, userId }: HomeProps) {
  useOAuthReturnRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
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
   * Consumes a one-shot handoff left by another surface (e.g. "Troubleshoot in
   * Chat" on an errored log viewed from a different route) and auto-sends it
   * into this fresh chat, tagging the run so Sim can inspect the failure. Only
   * the cross-route path lands here — when a chat is already mounted the event
   * above delivers directly. `consume` clears the entry atomically, so it fires
   * at most once even across a StrictMode remount or reload.
   */
  useEffect(() => {
    const handoff = MothershipHandoffStorage.consume()
    if (handoff) sendMessage(handoff.message, undefined, handoff.contexts)
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

  const workflowAliasEntries = useMemo(
    () =>
      buildWorkflowAliasWorkflowEntries(
        workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          folderId: workflow.folderId ?? null,
        })),
        folders.map((folder) => ({
          folderId: folder.id,
          folderName: folder.name,
          parentId: folder.parentId ?? null,
        }))
      ),
    [folders, workflows]
  )

  const resolveFileResource = useCallback(
    (resource: MothershipResource): MothershipResource => {
      if (resource.type !== 'file') return resource

      const reference = (resource.path || resource.id).trim()
      const workspacePlanAlias = resolveWorkspacePlanAliasPath(reference)
      const workflowAlias = workspacePlanAlias
        ? null
        : resolveWorkflowAliasPath(reference, workflowAliasEntries)
      const alias = workspacePlanAlias || workflowAlias
      const targetPath = alias && alias.kind !== 'plans_dir' ? alias.backingPath : reference

      const file = workspaceFiles.find((candidate) => {
        const candidatePath = canonicalWorkspaceFilePath({
          folderPath: candidate.folderPath,
          name: candidate.name,
        })
        return (
          candidate.id === reference || candidatePath === reference || candidatePath === targetPath
        )
      })

      if (!file) return resource
      return {
        ...resource,
        id: file.id,
        title: resource.title || file.name,
        path: alias ? reference : resource.path,
      }
    },
    [workflowAliasEntries, workspaceFiles]
  )

  function handleWorkspaceResourceSelect(resource: MothershipResource) {
    const resolvedResource = resolveFileResource(resource)
    const wasAdded = addResource(resolvedResource)
    if (!wasAdded) {
      setActiveResourceId(resolvedResource.id)
    }
    handleResourceEvent()
  }

  const hasMessages = messages.length > 0
  const showChatSkeleton = Boolean(chatId) && !hasMessages && isChatHistoryPending
  const draftScopeKey = `${workspaceId}:${chatId ?? 'new'}`

  if (!hasMessages && !showChatSkeleton) {
    return (
      <div className='relative h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
        <div className='absolute top-[8.5px] right-[16px] z-10'>
          <CreditsChip />
        </div>
        {/* Asymmetric padding biases the group up so the full cluster (heading + input + suggestions) sits at the optical center */}
        <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
          <h1 className='mb-7 max-w-[48rem] text-balance font-season text-[30px] text-[var(--text-primary)]'>
            What should we get done{firstName ? `, ${firstName}` : ''}?
          </h1>
          <div ref={initialViewInputRef} className='relative w-full max-w-[48rem]'>
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
                onSelectPrompt={(prompt) => initialViewUserInputRef.current?.populatePrompt(prompt)}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='relative flex h-full bg-[var(--bg)]'>
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
        />
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
            resources={resources}
            activeResourceId={activeResourceId}
            isCollapsed={isResourceCollapsed}
            previewSession={previewSession}
            isAgentResponding={isSending}
            genericResourceData={genericResourceData ?? undefined}
            className={skipResourceTransition ? '!transition-none' : undefined}
          />
        </Suspense>
      </MothershipResourcesProvider>

      {isResourceCollapsed && (
        <div className='absolute top-[8.5px] right-[16px]'>
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
      )}
    </div>
  )
}

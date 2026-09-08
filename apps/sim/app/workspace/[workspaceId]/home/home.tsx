'use client'

import {
  type Dispatch,
  lazy,
  type PointerEvent,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, cn, toast } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import { requestJson } from '@/lib/api/client/request'
import { createWorkflowContract } from '@/lib/api/contracts'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge/search'
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
/**
 * Imported from its own folder, not the components barrel: the workflow copilot
 * panel imports that barrel for the chat pieces, and a barrel edge to this
 * component would drag the Sim Search connector catalog — every connector
 * meta — into the workflow editor's graph. See sim-imports.md, "Code-splitting
 * through barrels".
 */
import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { SuggestedActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions'
import { useMothershipMode } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-mode'
import { resolveWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'
import {
  resolveResourceEventPresentation,
  resolveResourceSelectionUpdate,
} from '@/app/workspace/[workspaceId]/home/resource-view-policy'
import {
  CLEARED_SEARCH_FILTERS,
  type MothershipMode,
  resourceParam,
  resourceUrlKeys,
  searchFilterParsers,
  searchQueryParam,
} from '@/app/workspace/[workspaceId]/home/search-params'
import { useFolders } from '@/hooks/queries/folders'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'
import { useWorkflows } from '@/hooks/queries/workflows'
import { getWorkspaceFilesQueryOptions, useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useMemberAccessAvailable } from '@/hooks/use-member-access'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import type { ChatContext } from '@/stores/panel'
import {
  ChatSurfaceProvider,
  CreditsChip,
  MothershipChat,
  MothershipResourcesProvider,
  UserInput,
  type UserInputHandle,
} from './components'
import {
  getMothershipUseChatOptions,
  type ResourceEventOptions,
  shouldActivateResourceEvent,
  useChat,
  useMothershipResize,
} from './hooks'
import type {
  FileAttachmentForApi,
  MothershipResource,
  MothershipResourceType,
  QueuedMessage,
  WorkspaceResourceRef,
} from './types'

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
  const activeResourceParamRef = useRef(activeResourceParam)
  activeResourceParamRef.current = activeResourceParam
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
      const nextResourceId = resolveResourceSelectionUpdate(activeResourceParamRef.current, action)
      activeResourceParamRef.current = nextResourceId
      if (typeof window !== 'undefined' && window.location.hash) {
        const { pathname, search } = window.location
        window.history.replaceState(window.history.state, '', `${pathname}${search}`)
      }
      void setResourceParam(nextResourceId)
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
  /** The search query lives in the URL so a search is a shareable link; null between searches. */
  const [searchQueryValue, setSearchQueryParam] = useQueryState(searchQueryParam.key, {
    ...searchQueryParam.parser,
    ...resourceUrlKeys,
  })
  const searchQuery = searchQueryValue ?? ''
  const [, setSearchFilters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  /** A new or cleared query starts from unfiltered results. */
  const setSearchQuery = useCallback(
    (query: string) => {
      void setSearchQueryParam(query || null)
      void setSearchFilters(CLEARED_SEARCH_FILTERS)
    },
    [setSearchQueryParam, setSearchFilters]
  )
  const memberAccessAvailable = useMemberAccessAvailable()
  const [composerMode, setComposerMode] = useMothershipMode()
  const hasCheckedLandingStorageRef = useRef(false)
  const initialViewInputRef = useRef<HTMLDivElement>(null)
  const initialViewUserInputRef = useRef<UserInputHandle>(null)
  const chatViewUserInputRef = useRef<UserInputHandle>(null)

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

  const [isResourceCollapsed, setIsResourceCollapsedState] = useState(true)
  const [skipResourceTransition, setSkipResourceTransition] = useState(false)
  const [resourceActivityIds, setResourceActivityIds] = useState<Set<string>>(new Set())
  const isResourceCollapsedRef = useRef(isResourceCollapsed)
  const setResourceCollapsed = useCallback((collapsed: boolean) => {
    isResourceCollapsedRef.current = collapsed
    setIsResourceCollapsedState(collapsed)
  }, [])
  const resourceCollapseOwnedByUserRef = useRef(false)
  const resourceSelectionOwnedByUserRef = useRef(false)

  function handleResourceEvent(resourceId: string, options?: ResourceEventOptions) {
    const activeResourceId = activeResourceParamRef.current
    const presentation = resolveResourceEventPresentation({
      activeResourceId,
      activationRequested: shouldActivateResourceEvent(activeResourceId, resourceId, options),
      panelCollapseOwnedByUser: resourceCollapseOwnedByUserRef.current,
      panelCollapsed: isResourceCollapsedRef.current,
      resourceId,
      selectionOwnedByUser: resourceSelectionOwnedByUserRef.current,
    })

    if (presentation.revealPanel) setResourceCollapsed(false)
    if (presentation.markActivity) {
      setResourceActivityIds((current) => new Set(current).add(resourceId))
      return
    }
    setResourceActivityIds((current) => {
      if (!current.has(resourceId)) return current
      const next = new Set(current)
      next.delete(resourceId)
      return next
    })
    if (presentation.activateResource && activeResourceId !== resourceId) {
      activeResourceParamRef.current = resourceId
      setActiveResourceUrl(resourceId)
    }
  }

  const {
    messages,
    isChatHistoryPending,
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
  const effectiveActiveResourceIdRef = useRef(activeResourceId)
  effectiveActiveResourceIdRef.current = activeResourceId
  const resourceAttentionChatIdRef = useRef(resolvedChatId)

  const collapseResource = useCallback(() => {
    resourceCollapseOwnedByUserRef.current = true
    resourceSelectionOwnedByUserRef.current = true
    clearWidth()
    setResourceCollapsed(true)
  }, [clearWidth, setResourceCollapsed])

  const clearResourceActivity = useCallback((resourceId: string) => {
    setResourceActivityIds((current) => {
      if (!current.has(resourceId)) return current
      const next = new Set(current)
      next.delete(resourceId)
      return next
    })
  }, [])

  const expandResource = () => {
    resourceCollapseOwnedByUserRef.current = false
    resourceSelectionOwnedByUserRef.current = true
    const activeResourceId = activeResourceParamRef.current
    if (activeResourceId) clearResourceActivity(activeResourceId)
    setResourceCollapsed(false)
  }

  const selectResourceFromUser = useCallback(
    (resourceId: string) => {
      resourceSelectionOwnedByUserRef.current = true
      clearResourceActivity(resourceId)
      if (effectiveActiveResourceIdRef.current === resourceId) return
      effectiveActiveResourceIdRef.current = resourceId
      activeResourceParamRef.current = resourceId
      setActiveResourceId(resourceId)
    },
    [setActiveResourceId, clearResourceActivity]
  )

  const addResourceFromUser = useCallback(
    (resource: MothershipResource) => {
      resourceCollapseOwnedByUserRef.current = false
      resourceSelectionOwnedByUserRef.current = true
      addResource(resource)
      selectResourceFromUser(resource.id)
      setResourceCollapsed(false)
    },
    [addResource, selectResourceFromUser, setResourceCollapsed]
  )

  const handleResourceResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      resourceSelectionOwnedByUserRef.current = true
      handleResizePointerDown(event)
    },
    [handleResizePointerDown]
  )

  const handleResourceInteraction = useCallback(() => {
    resourceSelectionOwnedByUserRef.current = true
  }, [])

  const prepareResourceViewForAgentTurn = useCallback(() => {
    resourceSelectionOwnedByUserRef.current = false
    setResourceActivityIds(new Set())
  }, [])

  useEffect(() => {
    const previousChatId = resourceAttentionChatIdRef.current
    resourceAttentionChatIdRef.current = resolvedChatId
    wasSendingRef.current = false
    if (resolvedChatId) {
      markRead(resolvedChatId)
    } else {
      clearWidth()
      setResourceCollapsed(true)
    }
    if (!resolvedChatId || (previousChatId && previousChatId !== resolvedChatId)) {
      resourceCollapseOwnedByUserRef.current = false
      resourceSelectionOwnedByUserRef.current = false
      setResourceActivityIds(new Set())
    }
  }, [resolvedChatId, markRead, clearWidth, setResourceCollapsed])

  useEffect(() => {
    if (wasSendingRef.current && !isSending && resolvedChatId) {
      markRead(resolvedChatId)
    }
    wasSendingRef.current = isSending
  }, [isSending, resolvedChatId, markRead])

  useEffect(() => {
    if (
      !(resources.length > 0 && isResourceCollapsedRef.current) ||
      resourceCollapseOwnedByUserRef.current
    ) {
      return
    }
    setResourceCollapsed(false)
    setSkipResourceTransition(true)
    const id = requestAnimationFrame(() => setSkipResourceTransition(false))
    return () => cancelAnimationFrame(id)
  }, [resources, setResourceCollapsed])

  useEffect(() => {
    if (resources.length === 0 && !isResourceCollapsedRef.current) {
      clearWidth()
      setResourceCollapsed(true)
    }
  }, [resources, clearWidth, setResourceCollapsed])

  useEffect(() => {
    const resourceIds = new Set(resources.map((resource) => resource.id))
    setResourceActivityIds((current) => {
      const next = new Set([...current].filter((id) => resourceIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [resources])

  const handleStopGeneration = useCallback(() => {
    captureEvent(posthogRef.current, 'task_generation_aborted', {
      workspace_id: workspaceId,
      view: 'mothership',
      request_id: getCurrentRequestId(),
    })
    void stopGeneration().catch(() => {})
  }, [workspaceId, getCurrentRequestId, stopGeneration])

  const handleSubmit = useCallback(
    async (
      text: string,
      fileAttachments?: FileAttachmentForApi[],
      contexts?: ChatContext[],
      modeOverride?: MothershipMode,
      assistantSearch?: WorkspaceSearchFilters
    ) => {
      const trimmed = text.trim()
      if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return

      /**
       * Search lists documents, not a turn of the agent, and only a query can
       * be searched: attachments alone have nothing to search for. Assistant
       * makes the query a turn of the agent grounded in the sources.
       *
       * The override skips `useMothershipMode`, so the gate is applied again
       * where the mode is consumed: both modes answer from the workspace's
       * indexed sources, and neither is offered where those do not exist.
       */
      const requestedMode = modeOverride ?? composerMode
      const mode = requestedMode !== 'build' && !memberAccessAvailable ? 'build' : requestedMode
      const answering = mode === 'assistant'
      if (mode === 'search') {
        /** A search sends nothing, so an edit in progress is released rather than left waiting. */
        if (editingQueuedId) cancelQueueEdit()
        if (trimmed) setSearchQuery(trimmed)
        return
      }

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
      sendMessage(
        trimmed || 'Analyze the attached file(s).',
        fileAttachments,
        contexts,
        answering ? { requestMode: 'assistant', assistantSearch } : undefined
      )
    },
    [
      workspaceId,
      chatId,
      composerMode,
      memberAccessAvailable,
      editingQueuedId,
      cancelQueueEdit,
      prepareResourceViewForAgentTurn,
      sendMessage,
      setSearchQuery,
    ]
  )

  /**
   * A queued message re-enters the composer in the mode it was written in: an
   * Assistant question edits as an Assistant question, and never as a Search,
   * which submits nothing and would leave the edit stranded.
   */
  const restoreQueuedMode = useCallback(
    (requestMode: QueuedMessage['requestMode']) => {
      void setComposerMode(requestMode === 'assistant' ? 'assistant' : 'build')
    },
    [setComposerMode]
  )

  /** An emptied search box returns to the sources; a send in any other mode has no search to clear. */
  const clearSearch = useCallback(() => {
    if (searchQueryValue !== null) setSearchQuery('')
  }, [searchQueryValue, setSearchQuery])

  /**
   * Summarize or Answer on a result: switch to Assistant and hand the question
   * to it. The submit reads the mode from this render, so it is sent as an
   * Assistant turn directly rather than waiting for the URL to update, and the
   * box is emptied as a send empties it, so the query does not linger as a
   * draft under the answer.
   */
  const handleSummarize = async (prompt: string, assistantSearch: WorkspaceSearchFilters) => {
    await setComposerMode('assistant')
    initialViewUserInputRef.current?.clear()
    chatViewUserInputRef.current?.clear()
    void handleSubmit(prompt, undefined, undefined, 'assistant', assistantSearch)
  }
  const showSearchResults = composerMode === 'search' && searchQuery.trim().length > 0
  const searchResults = showSearchResults ? (
    <KnowledgeSearchResults
      workspaceId={workspaceId}
      query={searchQuery}
      onSummarize={handleSummarize}
    />
  ) : null

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
  const resourceActivityCount = resourceActivityIds.size
  const resourceToggleLabel = isResourceCollapsed
    ? resourceActivityCount > 0
      ? `Expand resource view, ${resourceActivityCount} resource${resourceActivityCount === 1 ? '' : 's'} updated`
      : 'Expand resource view'
    : 'Collapse resource view'

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
                    defaultValue={initialPrompt || searchQuery}
                    draftScopeKey={draftScopeKey}
                    onSubmit={handleSubmit}
                    canSearch={memberAccessAvailable}
                    clearOnSubmit={composerMode !== 'search'}
                    onCleared={clearSearch}
                    isSending={isSending}
                    onStopGeneration={handleStopGeneration}
                  />
                </ChatSurfaceProvider>
                {/* Anchored out of flow so expanding/collapsing never shifts the centered input */}
                <div className='absolute inset-x-0 top-full'>
                  {searchResults ?? (
                    <SuggestedActions
                      onSelectPrompt={(prompt) =>
                        initialViewUserInputRef.current?.populatePrompt(prompt)
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <MothershipChat
            workspaceId={workspaceId}
            messages={messages}
            isSending={isSending}
            searchResults={searchResults}
            searchQuery={searchQuery}
            userInputRef={chatViewUserInputRef}
            onRestoreQueuedMode={restoreQueuedMode}
            isReconnecting={isReconnecting}
            isLoading={showChatSkeleton}
            onSubmit={handleSubmit}
            canSearch={memberAccessAvailable}
            clearOnSubmit={composerMode !== 'search'}
            onCleared={clearSearch}
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
            onPointerDown={handleResourceResizePointerDown}
          />
        </div>
      )}

      <MothershipResourcesProvider
        selectResource={selectResourceFromUser}
        addResource={addResourceFromUser}
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
            activityResourceIds={resourceActivityIds}
            isCollapsed={isResourceCollapsed}
            previewSession={previewSession}
            isAgentResponding={isSending}
            genericResourceData={genericResourceData ?? undefined}
            onUserInteraction={handleResourceInteraction}
            className={skipResourceTransition ? 'transition-none!' : undefined}
          />
        </Suspense>
      </MothershipResourcesProvider>

      <div
        className={cn('z-30', RESOURCE_HEADER_CLASSES.overlay, RESOURCE_HEADER_CLASSES.endPosition)}
      >
        <Button
          variant='ghost'
          size={null}
          type='button'
          onClick={isResourceCollapsed ? expandResource : collapseResource}
          className="after:-translate-x-1/2 after:-translate-y-1/2 relative size-[var(--resource-header-toggle-size)] rounded-[8px] after:absolute after:top-1/2 after:left-1/2 after:size-[var(--resource-header-toggle-hit-size)] after:content-[''] hover-hover:bg-[var(--surface-active)]"
          aria-label={resourceToggleLabel}
        >
          <span className='relative'>
            <PanelLeft className='-scale-x-100 size-[16px] text-[var(--text-icon)]' />
            {isResourceCollapsed && resourceActivityIds.size > 0 && (
              <span
                aria-hidden='true'
                className='-top-0.5 -right-0.5 absolute size-1.5 rounded-full bg-[var(--brand-primary)]'
              />
            )}
          </span>
        </Button>
      </div>
    </div>
  )
}

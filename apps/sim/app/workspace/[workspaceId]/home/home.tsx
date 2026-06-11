'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { requestJson } from '@/lib/api/client/request'
import { createWorkflowContract } from '@/lib/api/contracts'
import { isEphemeralResource } from '@/lib/copilot/resources/types'
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
import { useFolders } from '@/hooks/queries/folders'
import {
  useMarkMothershipChatRead,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import { useMothershipTabsStore } from '@/stores/mothership-tabs/store'
import type { ChatContext } from '@/stores/panel'
import {
  ChatHistory,
  ChatSurfaceProvider,
  CreditsChip,
  MothershipChat,
  MothershipResourcesProvider,
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

  const [isChatCollapsed, setIsChatCollapsed] = useState(false)

  const closeChatPane = useCallback(() => {
    clearWidth()
    setIsChatCollapsed(true)
  }, [clearWidth])

  const reopenChatPane = useCallback(() => setIsChatCollapsed(false), [])

  // The tab strip is user-owned per workspace (browser-tab semantics): chats
  // merge their artifacts in additively; only the user closes/reorders tabs.
  const workspaceTabs = useMothershipTabsStore((s) => s.byWorkspace[workspaceId])
  const openTabs = useMothershipTabsStore((s) => s.openTabs)
  const closeTab = useMothershipTabsStore((s) => s.closeTab)
  const reorderTabs = useMothershipTabsStore((s) => s.reorderTabs)
  const setActiveTab = useMothershipTabsStore((s) => s.setActiveTab)
  const storeTabs = workspaceTabs?.tabs
  const storeActiveTabId = workspaceTabs?.activeTabId ?? null

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
    addResource,
    removeResource,
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
      // The panel follows the conversation: any resource the agent touches —
      // even one that's already an open tab — surfaces and takes focus, so
      // "switch to X" in chat actually switches the strip.
      onResourceTouched: (resource) => {
        openTabs(workspaceId, [resource], { focusId: resource.id })
      },
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

  // The panel renders the workspace tab strip plus the active chat's ephemeral
  // resources (in-flight streaming previews stay chat-scoped, never persisted).
  const ephemeralResources = useMemo(() => resources.filter(isEphemeralResource), [resources])
  const panelTabs = useMemo(
    () => [...(storeTabs ?? []), ...ephemeralResources],
    [storeTabs, ephemeralResources]
  )
  const chatArtifactKeys = useMemo(
    () => new Set(resources.filter((r) => !isEphemeralResource(r)).map((r) => `${r.type}:${r.id}`)),
    [resources]
  )

  // Merge the active chat's artifacts into the strip. Tracking merged keys per
  // chat means a tab the user closed mid-chat isn't resurrected by the next
  // render, while re-entering the chat later re-opens its artifacts. The last
  // fresh artifact gets focus (on switch that's the chat's most recent one; on
  // a live stream it's the resource the agent just touched).
  const mergedChatKeyRef = useRef<string | null>(null)
  const mergedKeysRef = useRef<Set<string>>(new Set())
  const initialResourceIdRef = useRef(initialResourceId)
  useEffect(() => {
    const chatKey = resolvedChatId ?? chatId ?? 'new'
    if (mergedChatKeyRef.current !== chatKey) {
      mergedChatKeyRef.current = chatKey
      mergedKeysRef.current = new Set()
    }
    const fresh = resources.filter(
      (r) => !isEphemeralResource(r) && !mergedKeysRef.current.has(`${r.type}:${r.id}`)
    )
    if (fresh.length === 0) return
    for (const r of fresh) mergedKeysRef.current.add(`${r.type}:${r.id}`)
    const urlFocus = initialResourceIdRef.current
    initialResourceIdRef.current = null
    // A URL-pinned resource wins outright: if it's one of this chat's fresh
    // artifacts, focus it; otherwise it's already focused in the strip (the
    // page the user opened the chat from), so the merge must not steal focus.
    const focusId = urlFocus
      ? fresh.some((r) => r.id === urlFocus)
        ? urlFocus
        : undefined
      : fresh[fresh.length - 1].id
    openTabs(workspaceId, fresh, focusId ? { focusId } : undefined)
  }, [resources, resolvedChatId, chatId, workspaceId, openTabs])

  const handleSelectTab = useCallback(
    (id: string) => {
      setActiveTab(workspaceId, id)
    },
    [setActiveTab, workspaceId]
  )

  const handleCloseTab = useCallback(
    (resourceType: MothershipResourceType, resourceId: string) => {
      closeTab(workspaceId, resourceType, resourceId)
    },
    [closeTab, workspaceId]
  )

  // Focus newly-appearing ephemeral resources (e.g. a streaming file preview),
  // mirroring how the chat focuses artifacts it touches.
  const prevEphemeralKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const keys = new Set(ephemeralResources.map((r) => `${r.type}:${r.id}`))
    const fresh = ephemeralResources.find(
      (r) => !prevEphemeralKeysRef.current.has(`${r.type}:${r.id}`)
    )
    prevEphemeralKeysRef.current = keys
    if (fresh) setActiveTab(workspaceId, fresh.id)
  }, [ephemeralResources, setActiveTab, workspaceId])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (storeActiveTabId) {
      url.searchParams.set('resource', storeActiveTabId)
    } else {
      url.searchParams.delete('resource')
    }
    url.hash = ''
    window.history.replaceState(null, '', url.toString())
  }, [storeActiveTabId])

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
    if (!(panelTabs.length > 0 && isResourceCollapsedRef.current)) return
    setIsResourceCollapsed(false)
    setSkipResourceTransition(true)
    const id = requestAnimationFrame(() => setSkipResourceTransition(false))
    return () => cancelAnimationFrame(id)
  }, [panelTabs])

  useEffect(() => {
    if (panelTabs.length === 0 && !isResourceCollapsedRef.current) {
      collapseResource()
    }
  }, [panelTabs, collapseResource])

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

  /**
   * Manually attaching a resource opens its tab (session) AND records it on
   * the chat (provenance + agent context) via {@link addResource}, which keeps
   * the existing persistence machinery.
   */
  function openResourceTab(resource: MothershipResource) {
    openTabs(workspaceId, [resource], { focusId: resource.id })
    addResource(resource)
    handleResourceEvent()
  }

  function handleContextAdd(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (resolved) {
      openResourceTab({ ...resolved, title: context.label })
    }
  }

  function handleInitialContextRemove(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (!resolved) return
    // Symmetric un-attach: the chip was just added by the same flow, so this
    // also detaches it from the chat rather than only closing the tab.
    closeTab(workspaceId, resolved.type, resolved.id)
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
    openResourceTab(resolveFileResource(resource))
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
  const canCloseChat = panelTabs.length > 0 && !isResourceCollapsed

  // The chat pane can only hide while the resource panel is visible; restore it
  // when the panel collapses or the last tab closes so the view never blanks.
  useEffect(() => {
    if (isChatCollapsed && (panelTabs.length === 0 || isResourceCollapsed)) {
      setIsChatCollapsed(false)
    }
  }, [isChatCollapsed, panelTabs, isResourceCollapsed])

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
              initialScrollBlocked={panelTabs.length > 0 && isResourceCollapsed}
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

        <MothershipResourcesProvider
          selectResource={handleSelectTab}
          addResource={openResourceTab}
          removeResource={handleCloseTab}
          reorderResources={(tabs) => reorderTabs(workspaceId, tabs)}
          collapseResource={collapseResource}
        >
          <MothershipView
            ref={mothershipRef}
            workspaceId={workspaceId}
            chatId={resolvedChatId}
            resources={panelTabs}
            activeResourceId={storeActiveTabId}
            chatArtifactKeys={chatArtifactKeys}
            isCollapsed={isResourceCollapsed}
            previewSession={previewSession}
            genericResourceData={genericResourceData ?? undefined}
            tabsLeading={
              isChatCollapsed ? (
                /* With the chat pane hidden, the tabs bar doubles as the title
                   bar. The gap-1 cluster mirrors the chat title bar exactly so
                   the toggle and switcher never shift when the pane closes. */
                <div className='flex flex-shrink-0 items-center gap-1'>
                  <SidebarToggle className='-ml-[9px]' />
                  <ChatSwitcher chatId={activeChatId} onSelectChat={reopenChatPane} />
                </div>
              ) : undefined
            }
            className={cn(
              skipResourceTransition && '!transition-none',
              isChatCollapsed && 'w-full flex-1 border-l-0'
            )}
          />
        </MothershipResourcesProvider>
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

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { Tooltip } from '@/components/emcn'
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
import { useMothershipStageStore } from '@/stores/mothership-stage/store'
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
import { ResourcePanelToggle } from './components/mothership-view/components/panel-header/resource-panel-toggle'
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

  const { mothershipRef, handleResizePointerDown, clearWidth, applyStoredWidth } =
    useMothershipResize()

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

  // The user's split is sticky: whenever the panel is visible beside the chat
  // pane, restore the persisted width (collapse paths clear the inline width,
  // and the chat-hidden state needs the panel back at w-full).
  useEffect(() => {
    if (!isResourceCollapsed && !isChatCollapsed) {
      applyStoredWidth()
    }
  }, [isResourceCollapsed, isChatCollapsed, applyStoredWidth])

  // The panel is a single-resource stage, owned per workspace: it shows the
  // one resource the Mothership conversation last touched (or the user last
  // attached). Staging a new resource replaces the previous one — no tabs.
  const stagedResource = useMothershipStageStore(
    (s) => s.byWorkspace[workspaceId]?.resource ?? null
  )
  const setStage = useMothershipStageStore((s) => s.setStage)
  const clearStage = useMothershipStageStore((s) => s.clearStage)

  // In-flight streaming previews stay chat-scoped and never persist: while one
  // is live it overrides the staged resource as the panel's content.
  const [ephemeralActiveId, setEphemeralActiveId] = useState<string | null>(null)

  function handleResourceEvent() {
    if (isResourceCollapsedRef.current) {
      setIsResourceCollapsed(false)
    }
  }

  /**
   * The chat the panel is following, readable from stream callbacks without
   * re-creating the options object (resolvedChatId lands a render later).
   */
  const activeChatIdRef = useRef<string | undefined>(chatId)

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
      // The panel follows the conversation: whatever the agent touches takes
      // the stage — a table, a file, a knowledge base, a workspace page, or a
      // workflow's full editor. One resource at a time, last touch wins.
      onResourceTouched: (resource) => {
        if (isEphemeralResource(resource)) {
          setEphemeralActiveId(resource.id)
          return
        }
        setStage(workspaceId, resource)
        setEphemeralActiveId(null)
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

  // In-flight streaming previews stay chat-scoped, never persisted. While one
  // is live (and was the last thing touched), it is the panel's content.
  const ephemeralResources = useMemo(() => resources.filter(isEphemeralResource), [resources])
  const ephemeralActive = ephemeralActiveId
    ? (ephemeralResources.find((r) => r.id === ephemeralActiveId) ?? null)
    : null
  const displayResource = ephemeralActive ?? stagedResource

  // Stage the active chat's artifacts as they surface. Tracking staged keys
  // per chat means an artifact only auto-stages once (closing the panel
  // mid-chat isn't undone by the next render), while re-entering the chat
  // later re-stages its most recent artifact.
  const stagedChatKeyRef = useRef<string | null>(null)
  const stagedKeysRef = useRef<Set<string>>(new Set())
  const initialResourceIdRef = useRef(initialResourceId)
  useEffect(() => {
    const chatKey = resolvedChatId ?? chatId ?? 'new'
    if (stagedChatKeyRef.current !== chatKey) {
      stagedChatKeyRef.current = chatKey
      stagedKeysRef.current = new Set()
    }
    const fresh = resources.filter(
      (r) => !isEphemeralResource(r) && !stagedKeysRef.current.has(`${r.type}:${r.id}`)
    )
    if (fresh.length === 0) return
    for (const r of fresh) stagedKeysRef.current.add(`${r.type}:${r.id}`)
    const urlFocus = initialResourceIdRef.current
    initialResourceIdRef.current = null
    // A URL-pinned resource wins outright: if it's one of this chat's fresh
    // artifacts, stage it; otherwise the stage already holds what the user
    // was viewing when they opened the chat, so hydration must not steal it.
    const target = urlFocus ? fresh.find((r) => r.id === urlFocus) : fresh[fresh.length - 1]
    if (target) setStage(workspaceId, target)
  }, [resources, resolvedChatId, chatId, workspaceId, setStage])

  // Surface newly-appearing ephemeral resources (e.g. a streaming file
  // preview), mirroring how the chat stages artifacts it touches; drop the
  // override once the preview is gone from the chat's resources.
  const prevEphemeralKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const keys = new Set(ephemeralResources.map((r) => `${r.type}:${r.id}`))
    const fresh = ephemeralResources.find(
      (r) => !prevEphemeralKeysRef.current.has(`${r.type}:${r.id}`)
    )
    prevEphemeralKeysRef.current = keys
    if (fresh) {
      setEphemeralActiveId(fresh.id)
      return
    }
    setEphemeralActiveId((current) =>
      current && !ephemeralResources.some((r) => r.id === current) ? null : current
    )
  }, [ephemeralResources])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (stagedResource) {
      url.searchParams.set('resource', stagedResource.id)
    } else {
      url.searchParams.delete('resource')
    }
    url.hash = ''
    window.history.replaceState(null, '', url.toString())
  }, [stagedResource])

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
    if (!(displayResource && isResourceCollapsedRef.current)) return
    setIsResourceCollapsed(false)
    setSkipResourceTransition(true)
    const id = requestAnimationFrame(() => setSkipResourceTransition(false))
    return () => cancelAnimationFrame(id)
  }, [displayResource])

  // Clearing the stage (the header's ✕, a vanished resource) does NOT collapse
  // the panel — it falls back to the quick-open empty state. Only the toggle
  // closes the panel.

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
   * Manually attaching a resource stages it AND records it on the chat
   * (provenance + agent context) via {@link addResource}, which keeps the
   * existing persistence machinery. All types stage the same way — a workflow
   * stages as its full editor.
   */
  const openStagedResource = useCallback(
    (resource: MothershipResource) => {
      setStage(workspaceId, resource)
      setEphemeralActiveId(null)
      addResource(resource)
      if (isResourceCollapsedRef.current) {
        setIsResourceCollapsed(false)
      }
    },
    [setStage, workspaceId, addResource]
  )

  /** Clears the stage; the panel collapses via the no-content effect. */
  const closeStagedResource = useCallback(() => {
    setEphemeralActiveId(null)
    clearStage(workspaceId)
  }, [clearStage, workspaceId])

  function handleContextAdd(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (resolved) {
      openStagedResource({ ...resolved, title: context.label })
    }
  }

  function handleInitialContextRemove(context: ChatContext) {
    const resolved = resolveResourceFromContext(context)
    if (!resolved) return
    // Symmetric un-attach: the chip was just added by the same flow, so this
    // also detaches it from the chat rather than only clearing the stage.
    const staged = useMothershipStageStore.getState().byWorkspace[workspaceId]?.resource
    if (staged && staged.type === resolved.type && staged.id === resolved.id) {
      clearStage(workspaceId)
    }
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
    openStagedResource(resolveFileResource(resource))
  }

  // `resolvedChatId` is the chat actually in view — the prop on direct nav, or
  // the id adopted when opening a chat inline from the All Chats list. Gating on
  // it (not just the prop) lets an inline-opened chat render its skeleton + view
  // before its history finishes loading.
  const activeChatId = resolvedChatId ?? chatId
  activeChatIdRef.current = activeChatId
  const { isPending: isActiveChatHistoryPending } = useMothershipChatHistory(activeChatId)
  const hasMessages = messages.length > 0
  const showChatSkeleton = Boolean(activeChatId) && !hasMessages && isActiveChatHistoryPending
  const showChatView = hasMessages || showChatSkeleton || Boolean(resolvedChatId)
  const draftScopeKey = `${workspaceId}:${chatId ?? 'new'}`
  // The chat can hide whenever the panel is visible — staged content and the
  // quick-open empty state both count as something to look at.
  const canCloseChat = !isResourceCollapsed

  // Restore the chat pane only when the panel collapses, so the view never
  // blanks (the stage clearing just drops the panel to its empty state).
  useEffect(() => {
    if (isChatCollapsed && isResourceCollapsed) {
      setIsChatCollapsed(false)
    }
  }, [isChatCollapsed, isResourceCollapsed])

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
          <div className='flex h-full min-w-[280px] flex-1 flex-col'>
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
              initialScrollBlocked={Boolean(displayResource) && isResourceCollapsed}
              onCloseChat={canCloseChat ? closeChatPane : undefined}
            />
          </div>
        )}

        {/* Resize handle — zero-width flex child whose absolute child straddles
            the border. A small grab pill fades in on hover so the affordance
            is discoverable without adding a permanent line. */}
        {!isChatCollapsed && !isResourceCollapsed && (
          <div className='relative z-20 w-0 flex-none'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <div
                  className='group absolute inset-y-0 left-[-4px] flex w-[8px] cursor-ew-resize items-center justify-center'
                  role='separator'
                  aria-orientation='vertical'
                  aria-label='Resize resource panel'
                  onPointerDown={handleResizePointerDown}
                >
                  <div className='h-[48px] w-[4px] rounded-full bg-[var(--text-subtle)] opacity-0 transition-opacity hover-hover:group-hover:opacity-100' />
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content side='left'>
                <p>Resize</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
        )}

        <MothershipResourcesProvider
          openResource={openStagedResource}
          closeResource={closeStagedResource}
        >
          <MothershipView
            ref={mothershipRef}
            workspaceId={workspaceId}
            chatId={resolvedChatId}
            resource={displayResource}
            isCollapsed={isResourceCollapsed}
            previewSession={previewSession}
            genericResourceData={genericResourceData ?? undefined}
            headerLeading={
              isChatCollapsed ? (
                /* With the chat pane hidden, the panel header doubles as the
                   title bar. The gap-1 cluster mirrors the chat title bar
                   exactly so the toggle and switcher never shift when the
                   pane closes. */
                <div className='flex flex-shrink-0 items-center gap-1'>
                  <SidebarToggle className='-ml-[9px]' />
                  <ChatSwitcher
                    chatId={activeChatId}
                    onSelectChat={reopenChatPane}
                    onOpenChat={reopenChatPane}
                    isWorking={isSending || isReconnecting}
                  />
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

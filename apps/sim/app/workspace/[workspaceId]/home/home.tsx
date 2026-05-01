'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { Button } from '@/components/emcn'
import { PanelLeft } from '@/components/emcn/icons'
import { requestJson } from '@/lib/api/client/request'
import { createWorkflowContract } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/auth-client'
import {
  LandingPromptStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
} from '@/lib/core/utils/browser-storage'
import { captureEvent } from '@/lib/posthog/client'
import { persistImportedWorkflow } from '@/lib/workflows/operations/import-export'
import { useChatHistory, useMarkTaskRead } from '@/hooks/queries/tasks'
import type { ChatContext } from '@/stores/panel'
import { MothershipChat, MothershipView, TemplatePrompts, UserInput } from './components'
import { getMothershipUseChatOptions, useChat, useMothershipResize } from './hooks'
import type { FileAttachmentForApi, MothershipResource, MothershipResourceType } from './types'

const logger = createLogger('Home')

interface HomeProps {
  chatId?: string
}

export function Home({ chatId }: HomeProps = {}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialResourceId = searchParams.get('resource')
  const { data: session } = useSession()
  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog
  const [initialPrompt, setInitialPrompt] = useState('')
  const hasCheckedLandingStorageRef = useRef(false)
  const initialViewInputRef = useRef<HTMLDivElement>(null)
  const templateRef = useRef<HTMLDivElement>(null)
  const baseInputHeightRef = useRef<number | null>(null)

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
          colorOverride: seed.color,
          createWorkflow: async ({ name, description, color, workspaceId }) => {
            return requestJson(createWorkflowContract, {
              body: {
                name,
                description,
                color,
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

  const { isPending: isChatHistoryPending } = useChatHistory(chatId)
  const { mutate: markRead } = useMarkTaskRead(workspaceId)

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
    previewSession,
    genericResourceData,
  } = useChat(
    workspaceId,
    chatId,
    getMothershipUseChatOptions({
      onResourceEvent: handleResourceEvent,
      initialActiveResourceId: initialResourceId,
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

  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) sendMessage(message)
    }
    window.addEventListener('mothership-send-message', handler)
    return () => window.removeEventListener('mothership-send-message', handler)
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

  const hasMessages = messages.length > 0
  const showChatSkeleton = Boolean(chatId) && !hasMessages && isChatHistoryPending
  const draftScopeKey = `${workspaceId}:${chatId ?? 'new'}`

  useEffect(() => {
    if (hasMessages) return
    const input = initialViewInputRef.current
    const templates = templateRef.current
    if (!input || !templates) return

    const ro = new ResizeObserver((entries) => {
      const height = entries[0].contentRect.height
      if (baseInputHeightRef.current === null) baseInputHeightRef.current = height
      const delta = Math.max(0, (height - baseInputHeightRef.current) / 2)
      templates.style.marginTop = delta > 0 ? `calc(-30vh + ${delta}px)` : ''
    })
    ro.observe(input)
    return () => ro.disconnect()
  }, [hasMessages])

  if (!hasMessages && !showChatSkeleton) {
    return (
      <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
        <div className='flex min-h-full flex-col items-center justify-center px-6 pb-[2vh]'>
          <h1
            data-tour='home-greeting'
            className='mb-6 max-w-[42rem] text-balance font-[430] font-season text-[32px] text-[var(--text-primary)] tracking-[-0.02em]'
          >
            What should we get done
            {session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}?
          </h1>
          <div ref={initialViewInputRef} className='w-full' data-tour='home-chat-input'>
            <UserInput
              defaultValue={initialPrompt}
              draftScopeKey={draftScopeKey}
              onSubmit={handleSubmit}
              isSending={isSending}
              onStopGeneration={handleStopGeneration}
              userId={session?.user?.id}
              onContextAdd={handleContextAdd}
              onContextRemove={handleInitialContextRemove}
            />
          </div>
        </div>
        <div
          ref={templateRef}
          data-tour='home-templates'
          className='-mt-[30vh] mx-auto w-full max-w-[68rem] px-4 pb-8 sm:px-6 lg:px-10'
        >
          <TemplatePrompts onSelect={handleSubmit} />
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
          onRemoveQueuedMessage={removeFromQueue}
          onSendQueuedMessage={sendNow}
          onEditQueuedMessage={editQueuedMessage}
          userId={session?.user?.id}
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
        onCollapse={collapseResource}
        isCollapsed={isResourceCollapsed}
        previewSession={previewSession}
        genericResourceData={genericResourceData ?? undefined}
        className={skipResourceTransition ? '!transition-none' : undefined}
      />

      {isResourceCollapsed && (
        <div className='absolute top-[8.5px] right-[16px]'>
          <Button
            variant='ghost'
            size={null}
            type='button'
            onClick={() => setIsResourceCollapsed(false)}
            className='h-[30px] w-[30px] rounded-[8px] hover-hover:bg-[var(--surface-active)]'
            aria-label='Expand resource view'
          >
            <PanelLeft className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          </Button>
        </div>
      )}
    </div>
  )
}

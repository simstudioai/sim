'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { PanelLeft } from '@/components/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { useSession } from '@/lib/auth/auth-client'
import {
  LandingPromptStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
} from '@/lib/core/utils/browser-storage'
import { persistImportedWorkflow } from '@/lib/workflows/operations/import-export'
import { MessageActions } from '@/app/workspace/[workspaceId]/components'
import { useChatHistory, useMarkTaskRead } from '@/hooks/queries/tasks'
import type { ChatContext } from '@/stores/panel'
import {
  MessageContent,
  MothershipView,
  QueuedMessages,
  TemplatePrompts,
  UserInput,
  UserMessageContent,
} from './components'
import { PendingTagIndicator } from './components/message-content/components/special-tags'
import { useAutoScroll, useChat, useMothershipResize } from './hooks'
import type { FileAttachmentForApi, MothershipResource, MothershipResourceType } from './types'

const logger = createLogger('Home')

interface FileAttachmentPillProps {
  mediaType: string
  filename: string
}

function FileAttachmentPill({ mediaType, filename }: FileAttachmentPillProps) {
  const Icon = getDocumentIcon(mediaType, filename)
  return (
    <div className='flex max-w-[140px] items-center gap-[5px] rounded-[10px] bg-[var(--surface-5)] px-[6px] py-[3px]'>
      <Icon className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate text-[11px] text-[var(--text-body)]'>{filename}</span>
    </div>
  )
}

interface HomeProps {
  chatId?: string
}

export function Home({ chatId }: HomeProps = {}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const { data: session } = useSession()
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
            const response = await fetch('/api/workflows', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                description,
                color,
                workspaceId,
              }),
            })

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              throw new Error(errorData.error || 'Failed to create workflow')
            }

            return response.json()
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

    // const templateId = LandingTemplateStorage.consume()
    // if (templateId) {
    //   logger.info('Retrieved landing page template, redirecting to template detail')
    //   router.replace(`/workspace/${workspaceId}/templates/${templateId}?use=true`)
    //   return
    // }

    const prompt = LandingPromptStorage.consume()
    if (prompt) {
      logger.info('Retrieved landing page prompt, populating home input')
      setInitialPrompt(prompt)
    }
  }, [createWorkflowFromLandingSeed, workspaceId, router])

  const wasSendingRef = useRef(false)

  useChatHistory(chatId)
  const { mutate: markRead } = useMarkTaskRead(workspaceId)

  const { mothershipRef, handleResizePointerDown, clearWidth } = useMothershipResize()

  const [isResourceCollapsed, setIsResourceCollapsed] = useState(true)
  const [isResourceAnimatingIn, setIsResourceAnimatingIn] = useState(false)
  const [skipResourceTransition, setSkipResourceTransition] = useState(false)
  const isResourceCollapsedRef = useRef(isResourceCollapsed)
  isResourceCollapsedRef.current = isResourceCollapsed

  const collapseResource = useCallback(() => {
    clearWidth()
    setIsResourceCollapsed(true)
  }, [clearWidth])
  const animatingInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startAnimatingIn = useCallback(() => {
    if (animatingInTimerRef.current) clearTimeout(animatingInTimerRef.current)
    setIsResourceAnimatingIn(true)
    animatingInTimerRef.current = setTimeout(() => {
      setIsResourceAnimatingIn(false)
      animatingInTimerRef.current = null
    }, 400)
  }, [])

  const expandResource = useCallback(() => {
    setIsResourceCollapsed(false)
    startAnimatingIn()
  }, [startAnimatingIn])

  const handleResourceEvent = useCallback(() => {
    if (isResourceCollapsedRef.current) {
      setIsResourceCollapsed(false)
      startAnimatingIn()
    }
  }, [startAnimatingIn])

  const {
    messages,
    isSending,
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
  } = useChat(workspaceId, chatId, { onResourceEvent: handleResourceEvent })

  const [editingInputValue, setEditingInputValue] = useState('')
  const [prevChatId, setPrevChatId] = useState(chatId)
  const clearEditingValue = useCallback(() => setEditingInputValue(''), [])

  // Clear editing value when navigating to a different chat (guarded render-phase update)
  if (chatId !== prevChatId) {
    setPrevChatId(chatId)
    setEditingInputValue('')
  }

  const handleEditQueuedMessage = useCallback(
    (id: string) => {
      const msg = editQueuedMessage(id)
      if (msg) {
        setEditingInputValue(msg.content)
      }
    },
    [editQueuedMessage]
  )

  useEffect(() => {
    wasSendingRef.current = false
    if (resolvedChatId) markRead(resolvedChatId)
  }, [resolvedChatId, markRead])

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

  const handleSubmit = useCallback(
    (text: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
      const trimmed = text.trim()
      if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return

      if (initialViewInputRef.current) {
        setIsInputEntering(true)
      }

      sendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments, contexts)
    },
    [sendMessage]
  )

  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) sendMessage(message)
    }
    window.addEventListener('mothership-send-message', handler)
    return () => window.removeEventListener('mothership-send-message', handler)
  }, [sendMessage])

  const handleContextAdd = useCallback(
    (context: ChatContext) => {
      let resourceType: MothershipResourceType | null = null
      let resourceId: string | null = null
      const resourceTitle: string = context.label

      switch (context.kind) {
        case 'workflow':
        case 'current_workflow':
          resourceType = 'workflow'
          resourceId = context.workflowId
          break
        case 'knowledge':
          if (context.knowledgeId) {
            resourceType = 'knowledgebase'
            resourceId = context.knowledgeId
          }
          break
        case 'table':
          if (context.tableId) {
            resourceType = 'table'
            resourceId = context.tableId
          }
          break
        case 'file':
          if (context.fileId) {
            resourceType = 'file'
            resourceId = context.fileId
          }
          break
        default:
          break
      }

      if (resourceType && resourceId) {
        const resource: MothershipResource = {
          type: resourceType,
          id: resourceId,
          title: resourceTitle,
        }
        addResource(resource)
        handleResourceEvent()
      }
    },
    [addResource, handleResourceEvent]
  )

  const { ref: scrollContainerRef, scrollToBottom } = useAutoScroll(isSending)

  const hasMessages = messages.length > 0
  const initialScrollDoneRef = useRef(false)

  useLayoutEffect(() => {
    if (!hasMessages) {
      initialScrollDoneRef.current = false
      return
    }
    if (initialScrollDoneRef.current) return
    if (resources.length > 0 && isResourceCollapsed) return

    initialScrollDoneRef.current = true
    scrollToBottom()
  }, [hasMessages, resources.length, isResourceCollapsed, scrollToBottom])

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

  if (!hasMessages && !chatId) {
    return (
      <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable]'>
        <div className='flex min-h-full flex-col items-center justify-center px-[24px] pb-[2vh]'>
          <h1 className='mb-[24px] max-w-[42rem] font-[430] font-season text-[32px] text-[var(--text-primary)] tracking-[-0.02em]'>
            What should we get done
            {session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}?
          </h1>
          <div ref={initialViewInputRef} className='w-full'>
            <UserInput
              defaultValue={initialPrompt}
              onSubmit={handleSubmit}
              isSending={isSending}
              onStopGeneration={stopGeneration}
              userId={session?.user?.id}
              onContextAdd={handleContextAdd}
            />
          </div>
        </div>
        <div
          ref={templateRef}
          className='-mt-[30vh] mx-auto w-full max-w-[68rem] px-[16px] pb-[32px] sm:px-[24px] lg:px-[40px]'
        >
          <TemplatePrompts onSelect={handleSubmit} />
        </div>
      </div>
    )
  }

  return (
    <div className='relative flex h-full bg-[var(--bg)]'>
      <div className='flex h-full min-w-[320px] flex-1 flex-col'>
        <div
          ref={scrollContainerRef}
          className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4 pb-8 [scrollbar-gutter:stable]'
        >
          <div className='mx-auto max-w-[42rem] space-y-6'>
            {messages.map((msg, index) => {
              if (msg.role === 'user') {
                const hasAttachments = msg.attachments && msg.attachments.length > 0
                return (
                  <div key={msg.id} className='flex flex-col items-end gap-[6px] pt-3'>
                    {hasAttachments && (
                      <div className='flex max-w-[70%] flex-wrap justify-end gap-[6px]'>
                        {msg.attachments!.map((att) => {
                          const isImage = att.media_type.startsWith('image/')
                          return isImage && att.previewUrl ? (
                            <div
                              key={att.id}
                              className='h-[56px] w-[56px] overflow-hidden rounded-[8px]'
                            >
                              <img
                                src={att.previewUrl}
                                alt={att.filename}
                                className='h-full w-full object-cover'
                              />
                            </div>
                          ) : (
                            <FileAttachmentPill
                              key={att.id}
                              mediaType={att.media_type}
                              filename={att.filename}
                            />
                          )
                        })}
                      </div>
                    )}
                    <div className='max-w-[70%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3.5 py-2'>
                      <UserMessageContent content={msg.content} contexts={msg.contexts} />
                    </div>
                  </div>
                )
              }

              const hasBlocks = msg.contentBlocks && msg.contentBlocks.length > 0
              const isLastAssistant = msg.role === 'assistant' && index === messages.length - 1
              const isThisStreaming = isSending && isLastAssistant

              if (!hasBlocks && !msg.content && isThisStreaming) {
                return <PendingTagIndicator key={msg.id} />
              }

              if (!hasBlocks && !msg.content) return null

              const isLastMessage = index === messages.length - 1

              return (
                <div key={msg.id} className='group/msg relative pb-5'>
                  {!isThisStreaming && (msg.content || msg.contentBlocks?.length) && (
                    <div className='absolute right-0 bottom-0 z-10'>
                      <MessageActions content={msg.content} requestId={msg.requestId} />
                    </div>
                  )}
                  <MessageContent
                    blocks={msg.contentBlocks || []}
                    fallbackContent={msg.content}
                    isStreaming={isThisStreaming}
                    onOptionSelect={isLastMessage ? sendMessage : undefined}
                  />
                </div>
              )
            })}
          </div>
        </div>

        <div
          className={`flex-shrink-0 px-[24px] pb-[16px]${isInputEntering ? ' animate-slide-in-bottom' : ''}`}
          onAnimationEnd={isInputEntering ? () => setIsInputEntering(false) : undefined}
        >
          <div className='mx-auto max-w-[42rem]'>
            <QueuedMessages
              messageQueue={messageQueue}
              onRemove={removeFromQueue}
              onSendNow={sendNow}
              onEdit={handleEditQueuedMessage}
            />
            <UserInput
              onSubmit={handleSubmit}
              isSending={isSending}
              onStopGeneration={stopGeneration}
              isInitialView={false}
              userId={session?.user?.id}
              onContextAdd={handleContextAdd}
              editValue={editingInputValue}
              onEditValueConsumed={clearEditingValue}
            />
          </div>
        </div>
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
        className={
          isResourceAnimatingIn
            ? 'animate-slide-in-right'
            : skipResourceTransition
              ? '!transition-none'
              : undefined
        }
      />

      {isResourceCollapsed && (
        <div className='absolute top-[8.5px] right-[16px]'>
          <button
            type='button'
            onClick={expandResource}
            className='flex h-[30px] w-[30px] items-center justify-center rounded-[8px] hover:bg-[var(--surface-active)]'
            aria-label='Expand resource view'
          >
            <PanelLeft className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          </button>
        </div>
      )}
    </div>
  )
}

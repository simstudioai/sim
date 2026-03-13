'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { Skeleton } from '@/components/emcn'
import { PanelLeft } from '@/components/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { useSession } from '@/lib/auth/auth-client'
import {
  LandingPromptStorage,
  LandingTemplateStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
} from '@/lib/core/utils/browser-storage'
import { persistImportedWorkflow } from '@/lib/workflows/operations/import-export'
import { useChatHistory, useMarkTaskRead } from '@/hooks/queries/tasks'
import type { ChatContext } from '@/stores/panel'
import {
  MessageContent,
  MothershipView,
  TemplatePrompts,
  UserInput,
  UserMessageContent,
} from './components'
import type { FileAttachmentForApi } from './components/user-input/user-input'
import { useAutoScroll, useChat } from './hooks'
import type { MothershipResource, MothershipResourceType } from './types'

const logger = createLogger('Home')

const THINKING_BLOCKS = [
  { color: '#2ABBF8', delay: '0s' },
  { color: '#00F701', delay: '0.2s' },
  { color: '#FA4EDF', delay: '0.6s' },
  { color: '#FFCC02', delay: '0.4s' },
] as const

function ThinkingIndicator() {
  return (
    <div className='grid h-[16px] w-[16px] grid-cols-2 gap-[1.5px]'>
      {THINKING_BLOCKS.map((block, i) => (
        <div
          key={i}
          className='animate-thinking-block rounded-[2px]'
          style={{ backgroundColor: block.color, animationDelay: block.delay }}
        />
      ))}
    </div>
  )
}

interface FileAttachmentPillProps {
  mediaType: string
  filename: string
}

function FileAttachmentPill({ mediaType, filename }: FileAttachmentPillProps) {
  const Icon = getDocumentIcon(mediaType, filename)
  return (
    <div className='flex max-w-[140px] items-center gap-[5px] rounded-[10px] bg-[var(--surface-5)] px-[6px] py-[3px]'>
      <Icon className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]' />
      <span className='truncate text-[11px] text-[var(--text-secondary)]'>{filename}</span>
    </div>
  )
}

const SKELETON_LINE_COUNT = 4

function ChatSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='min-h-0 flex-1 overflow-hidden px-6 py-4'>
        <div className='mx-auto max-w-[42rem] space-y-[10px] pt-3'>
          {Array.from({ length: SKELETON_LINE_COUNT }).map((_, i) => (
            <Skeleton key={i} className='h-[16px]' style={{ width: `${120 + (i % 4) * 48}px` }} />
          ))}
        </div>
      </div>
      <div className='flex-shrink-0 px-[24px] pb-[16px]'>{children}</div>
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

    const templateId = LandingTemplateStorage.consume()
    if (templateId) {
      logger.info('Retrieved landing page template, redirecting to template detail')
      router.replace(`/workspace/${workspaceId}/templates/${templateId}?use=true`)
      return
    }

    const prompt = LandingPromptStorage.consume()
    if (prompt) {
      logger.info('Retrieved landing page prompt, populating home input')
      setInitialPrompt(prompt)
    }
  }, [createWorkflowFromLandingSeed, workspaceId, router])

  const wasSendingRef = useRef(false)

  const { isLoading: isLoadingHistory } = useChatHistory(chatId)
  const { mutate: markRead } = useMarkTaskRead(workspaceId)

  const [isResourceCollapsed, setIsResourceCollapsed] = useState(true)
  const [isResourceAnimatingIn, setIsResourceAnimatingIn] = useState(false)
  const [skipResourceTransition, setSkipResourceTransition] = useState(false)
  const isResourceCollapsedRef = useRef(isResourceCollapsed)
  isResourceCollapsedRef.current = isResourceCollapsed

  const collapseResource = useCallback(() => setIsResourceCollapsed(true), [])
  const expandResource = useCallback(() => {
    setIsResourceCollapsed(false)
    setIsResourceAnimatingIn(true)
  }, [])

  const handleResourceEvent = useCallback(() => {
    if (isResourceCollapsedRef.current) {
      setIsResourceCollapsed(false)
      setIsResourceAnimatingIn(true)
    }
  }, [])

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
  } = useChat(workspaceId, chatId, { onResourceEvent: handleResourceEvent })

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

  const visibleResources = resources

  useEffect(() => {
    if (!isResourceAnimatingIn) return
    const timer = setTimeout(() => setIsResourceAnimatingIn(false), 400)
    return () => clearTimeout(timer)
  }, [isResourceAnimatingIn])

  useEffect(() => {
    if (resources.length > 0 && isResourceCollapsedRef.current) {
      setSkipResourceTransition(true)
      setIsResourceCollapsed(false)
    }
  }, [resources])

  useEffect(() => {
    if (!skipResourceTransition) return
    const id = requestAnimationFrame(() => setSkipResourceTransition(false))
    return () => cancelAnimationFrame(id)
  }, [skipResourceTransition])

  const handleSubmit = useCallback(
    (text: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
      const trimmed = text.trim()
      if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return
      sendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments, contexts)
    },
    [sendMessage]
  )

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

  const scrollContainerRef = useAutoScroll(isSending)

  const hasMessages = messages.length > 0

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

  if (!hasMessages && chatId && isLoadingHistory) {
    return (
      <ChatSkeleton>
        <UserInput
          onSubmit={handleSubmit}
          isSending={isSending}
          onStopGeneration={stopGeneration}
          isInitialView={false}
          userId={session?.user?.id}
          onContextAdd={handleContextAdd}
        />
      </ChatSkeleton>
    )
  }

  if (!hasMessages) {
    return (
      <div className='h-full overflow-y-auto bg-[var(--bg)]'>
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
        <div ref={templateRef} className='-mt-[30vh] mx-auto w-full max-w-[42rem] pb-[32px]'>
          <TemplatePrompts onSelect={handleSubmit} />
        </div>
      </div>
    )
  }

  return (
    <div className='relative flex h-full bg-[var(--bg)]'>
      <div className='flex h-full min-w-0 flex-1 flex-col'>
        <div
          ref={scrollContainerRef}
          className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4 pb-4'
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
                    <div className='max-w-[70%] rounded-[16px] bg-[var(--surface-5)] px-3.5 py-2'>
                      <UserMessageContent content={msg.content} contexts={msg.contexts} />
                    </div>
                  </div>
                )
              }

              const hasBlocks = msg.contentBlocks && msg.contentBlocks.length > 0
              const isLastAssistant = msg.role === 'assistant' && index === messages.length - 1
              const isThisStreaming = isSending && isLastAssistant

              if (!hasBlocks && !msg.content && isThisStreaming) {
                return (
                  <div key={msg.id} className='flex items-center gap-[8px] py-[8px]'>
                    <ThinkingIndicator />
                    <span className='font-base text-[14px] text-[var(--text-body)]'>Thinking…</span>
                  </div>
                )
              }

              if (!hasBlocks && !msg.content) return null

              const isLastMessage = index === messages.length - 1

              return (
                <div key={msg.id} className='pb-4'>
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

        <div className='flex-shrink-0 px-[24px] pb-[16px]'>
          <div className='mx-auto max-w-[42rem]'>
            <UserInput
              onSubmit={handleSubmit}
              isSending={isSending}
              onStopGeneration={stopGeneration}
              isInitialView={false}
              userId={session?.user?.id}
              onContextAdd={handleContextAdd}
            />
          </div>
        </div>
      </div>

      <MothershipView
        workspaceId={workspaceId}
        chatId={resolvedChatId}
        resources={visibleResources}
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

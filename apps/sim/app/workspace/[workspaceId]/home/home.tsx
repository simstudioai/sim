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
import { useChatHistory } from '@/hooks/queries/tasks'
import { MessageContent, MothershipView, TemplatePrompts, UserInput } from './components'
import type { FileAttachmentForApi } from './components/user-input/user-input'
import { useAutoScroll, useChat } from './hooks'

const logger = createLogger('Home')

const RESOURCE_PANEL_EXPAND_DELAY = 175

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

  const { isLoading: isLoadingHistory } = useChatHistory(chatId)

  const {
    messages,
    isSending,
    sendMessage,
    stopGeneration,
    resources,
    isResourceCleanupSettled,
    activeResourceId,
    setActiveResourceId,
  } = useChat(workspaceId, chatId)

  const [isResourceCollapsed, setIsResourceCollapsed] = useState(false)
  const [showExpandButton, setShowExpandButton] = useState(false)
  const [isResourceAnimatingIn, setIsResourceAnimatingIn] = useState(false)

  useEffect(() => {
    if (!isResourceCollapsed) {
      setShowExpandButton(false)
      return
    }
    const timer = setTimeout(() => setShowExpandButton(true), RESOURCE_PANEL_EXPAND_DELAY)
    return () => clearTimeout(timer)
  }, [isResourceCollapsed])

  const collapseResource = useCallback(() => setIsResourceCollapsed(true), [])
  const expandResource = useCallback(() => setIsResourceCollapsed(false), [])

  const visibleResources = isResourceCleanupSettled ? resources : []
  const prevResourceCountRef = useRef(visibleResources.length)
  const shouldEnterResourcePanel =
    isSending && prevResourceCountRef.current === 0 && visibleResources.length > 0
  useEffect(() => {
    if (shouldEnterResourcePanel) {
      setIsResourceAnimatingIn(true)
    }
    prevResourceCountRef.current = visibleResources.length
  }, [shouldEnterResourcePanel, visibleResources.length])

  useEffect(() => {
    if (!isResourceAnimatingIn) return
    const timer = setTimeout(() => setIsResourceAnimatingIn(false), 400)
    return () => clearTimeout(timer)
  }, [isResourceAnimatingIn])

  const handleSubmit = useCallback(
    (text: string, fileAttachments?: FileAttachmentForApi[]) => {
      const trimmed = text.trim()
      if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return
      sendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments)
    },
    [sendMessage]
  )

  const scrollContainerRef = useAutoScroll(isSending)

  const hasMessages = messages.length > 0

  if (!hasMessages && chatId && isLoadingHistory) {
    return (
      <ChatSkeleton>
        <UserInput
          onSubmit={handleSubmit}
          isSending={isSending}
          onStopGeneration={stopGeneration}
          isInitialView={false}
          userId={session?.user?.id}
        />
      </ChatSkeleton>
    )
  }

  if (!hasMessages) {
    return (
      <div className='h-full overflow-y-auto bg-[var(--bg)]'>
        <div className='flex min-h-full flex-col items-center justify-center px-[24px] pb-[2vh]'>
          <h1 className='mb-[24px] max-w-[42rem] font-[440] font-season text-[32px] text-[var(--text-primary)] tracking-[-0.02em]'>
            What should we get done
            {session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}?
          </h1>
          <UserInput
            defaultValue={initialPrompt}
            onSubmit={handleSubmit}
            isSending={isSending}
            onStopGeneration={stopGeneration}
            userId={session?.user?.id}
          />
        </div>
        <div className='-mt-[30vh] mx-auto w-full max-w-[42rem] px-[16px] pb-[32px]'>
          <TemplatePrompts onSelect={(prompt) => handleSubmit(prompt)} />
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
                      <p className='whitespace-pre-wrap font-[430] font-[family-name:var(--font-inter)] text-[15px] text-[var(--text-primary)] leading-[23px] tracking-[0] antialiased'>
                        {msg.content}
                      </p>
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
                    <span className='font-[var(--sidebar-font-weight)] text-[14px] text-[var(--text-body)]'>
                      Thinking…
                    </span>
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
            />
          </div>
        </div>
      </div>

      {visibleResources.length > 0 && (
        <MothershipView
          workspaceId={workspaceId}
          resources={visibleResources}
          activeResourceId={activeResourceId}
          onSelectResource={setActiveResourceId}
          onCollapse={collapseResource}
          isCollapsed={isResourceCollapsed}
          className={isResourceAnimatingIn ? 'animate-slide-in-right' : undefined}
        />
      )}

      {visibleResources.length > 0 && showExpandButton && (
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

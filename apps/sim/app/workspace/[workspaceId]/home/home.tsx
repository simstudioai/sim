'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import {
  LandingPromptStorage,
  LandingTemplateStorage,
  type LandingWorkflowSeed,
  LandingWorkflowSeedStorage,
} from '@/lib/core/utils/browser-storage'
import { persistImportedWorkflow } from '@/lib/workflows/operations/import-export'
import { MessageContent, MothershipView, UserInput } from './components'
import type { FileAttachmentForApi } from './components/user-input/user-input'
import { useChat } from './hooks'

const logger = createLogger('Home')

interface HomeProps {
  chatId?: string
}

export function Home({ chatId }: HomeProps = {}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const [inputValue, setInputValue] = useState('')
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
      setInputValue(prompt)
    }
  }, [createWorkflowFromLandingSeed, workspaceId, router])

  const {
    messages,
    isSending,
    sendMessage,
    stopGeneration,
    chatBottomRef,
    resources,
    activeResourceId,
    setActiveResourceId,
  } = useChat(workspaceId, chatId)

  const handleSubmit = useCallback(
    (fileAttachments?: FileAttachmentForApi[]) => {
      const trimmed = inputValue.trim()
      if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return
      setInputValue('')
      sendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments)
    },
    [inputValue, sendMessage]
  )

  const hasMessages = messages.length > 0

  if (!hasMessages) {
    return (
      <div className='flex h-full flex-col items-center justify-center bg-[var(--bg)] px-[24px]'>
        <h1 className='mb-[24px] font-[450] font-season text-[32px] text-[var(--text-primary)] tracking-[-0.02em]'>
          What do you want to do?
        </h1>
        <UserInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          isSending={isSending}
          onStopGeneration={stopGeneration}
          userId={session?.user?.id}
        />
      </div>
    )
  }

  return (
    <div className='flex h-full bg-[var(--bg)]'>
      <div className='flex h-full min-w-0 flex-1 flex-col'>
        <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-4'>
          <div className='mx-auto max-w-[42rem] space-y-6'>
            {messages.map((msg, index) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className='flex justify-end pt-3'>
                    <div className='max-w-[70%] rounded-[22px] bg-[var(--surface-5)] px-4 py-2.5'>
                      <p className='whitespace-pre-wrap font-[420] font-[family-name:var(--font-inter)] text-[16px] text-[var(--text-primary)] leading-6 tracking-[0] antialiased'>
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
                  <div key={msg.id} className='flex items-center gap-[6px] py-[8px]'>
                    <div className='h-[6px] w-[6px] animate-pulse rounded-full bg-[var(--text-tertiary)]' />
                    <span className='font-base text-[13px] text-[var(--text-tertiary)]'>
                      Thinking…
                    </span>
                  </div>
                )
              }

              if (!hasBlocks && !msg.content) return null

              return (
                <div key={msg.id} className='pb-4'>
                  <MessageContent
                    blocks={msg.contentBlocks || []}
                    fallbackContent={msg.content}
                    isStreaming={isThisStreaming}
                  />
                </div>
              )
            })}
            <div ref={chatBottomRef} />
          </div>
        </div>

        <div className='flex-shrink-0 px-[24px] pb-[16px]'>
          <UserInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            isSending={isSending}
            onStopGeneration={stopGeneration}
            isInitialView={false}
            userId={session?.user?.id}
          />
        </div>
      </div>

      {resources.length > 0 && (
        <MothershipView
          workspaceId={workspaceId}
          resources={resources}
          activeResourceId={activeResourceId}
          onSelectResource={setActiveResourceId}
        />
      )}
    </div>
  )
}

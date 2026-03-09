'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'
import { MessageContent, MothershipView, UserInput } from './components'
import { useChat } from './hooks'

const logger = createLogger('Home')

interface HomeProps {
  chatId?: string
}

export function Home({ chatId }: HomeProps = {}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [inputValue, setInputValue] = useState('')
  const hasCheckedLandingPromptRef = useRef(false)

  useEffect(() => {
    if (hasCheckedLandingPromptRef.current) return
    hasCheckedLandingPromptRef.current = true

    const prompt = LandingPromptStorage.consume()
    if (prompt) {
      logger.info('Retrieved landing page prompt, populating home input')
      setInputValue(prompt)
    }
  }, [])

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

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    setInputValue('')
    sendMessage(trimmed)
  }, [inputValue, sendMessage])

  const hasMessages = messages.length > 0

  if (!hasMessages) {
    return (
      <div className='flex h-full flex-col items-center justify-center bg-[#FCFCFC] px-[24px] dark:bg-[var(--surface-2)]'>
        <h1 className='mb-[24px] font-[450] font-season text-[32px] text-[var(--text-primary)] tracking-[-0.02em]'>
          What do you want to do?
        </h1>
        <UserInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          isSending={isSending}
          onStopGeneration={stopGeneration}
        />
      </div>
    )
  }

  return (
    <div className='flex h-full bg-[#FCFCFC] dark:bg-[var(--surface-2)]'>
      <div className='flex h-full min-w-0 flex-1 flex-col'>
        <div className='min-h-0 flex-1 overflow-y-auto px-[24px] py-[16px]'>
          <div className='mx-auto max-w-[640px] space-y-[16px]'>
            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className='flex justify-end'>
                    <div className='max-w-[80%] rounded-[16px] bg-[var(--surface-5)] px-[14px] py-[4px]'>
                      <p className='whitespace-pre-wrap font-[380] font-body text-[16px] text-[var(--text-primary)] leading-[1.75] tracking-[-0.015em]'>
                        {msg.content}
                      </p>
                    </div>
                  </div>
                )
              }

              const hasBlocks = msg.contentBlocks && msg.contentBlocks.length > 0
              const isThisStreaming = isSending && msg === messages[messages.length - 1]

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
                <div key={msg.id}>
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

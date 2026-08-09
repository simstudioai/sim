'use client'

import type { Ref, RefObject } from 'react'
import { Button } from '@sim/emcn'
import { ArrowDown } from '@sim/emcn/icons'
import {
  type ChatMessage,
  ClientChatMessage,
} from '@/app/(interfaces)/chat/components/message/message'

interface ChatMessageContainerProps {
  messages: ChatMessage[]
  isLoading: boolean
  showScrollButton: boolean
  messagesContainerRef: Ref<HTMLDivElement>
  messagesEndRef: RefObject<HTMLDivElement>
  scrollToBottom: () => void
  chatConfig: {
    description?: string
  } | null
}

export function ChatMessageContainer({
  messages,
  isLoading,
  showScrollButton,
  messagesContainerRef,
  messagesEndRef,
  scrollToBottom,
  chatConfig,
}: ChatMessageContainerProps) {
  return (
    <div className='relative flex flex-1 flex-col overflow-hidden'>
      <div
        ref={messagesContainerRef}
        className='absolute inset-0 touch-pan-y overflow-y-auto overscroll-auto scroll-smooth'
      >
        <div className='mx-auto max-w-3xl px-4 pt-10 pb-20'>
          {messages.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-10'>
              <div className='space-y-2 text-center'>
                <h3 className='text-[var(--text-primary)] text-lg'>How can I help you today?</h3>
                <p className='text-[var(--text-muted)] text-sm'>
                  {chatConfig?.description || 'Ask me anything.'}
                </p>
              </div>
            </div>
          ) : (
            messages.map((message) => <ClientChatMessage key={message.id} message={message} />)
          )}

          {isLoading && (
            <div className='px-4 py-5'>
              <div className='mx-auto max-w-3xl'>
                <div className='flex'>
                  <div className='max-w-[80%]'>
                    <div className='flex h-6 items-center'>
                      <div className='loading-dot size-3 rounded-full bg-[var(--text-primary)]' />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {showScrollButton && (
        <div className='-translate-x-1/2 absolute bottom-16 left-1/2 z-20 transform'>
          <Button
            onClick={scrollToBottom}
            size='sm'
            className='gap-1 rounded-full px-3 py-1 shadow-medium'
          >
            <ArrowDown className='size-3.5' />
            <span className='sr-only'>Scroll to bottom</span>
          </Button>
        </div>
      )}
    </div>
  )
}

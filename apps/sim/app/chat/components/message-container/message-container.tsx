'use client'

import { memo, type RefObject } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type ChatMessage, ClientChatMessage } from '@/app/chat/components/message/message'

interface ChatMessageContainerProps {
  messages: ChatMessage[]
  isLoading: boolean
  showScrollButton: boolean
  messagesContainerRef: RefObject<HTMLDivElement>
  messagesEndRef: RefObject<HTMLDivElement>
  scrollToBottom: () => void
  scrollToMessage?: (messageId: string) => void
  chatConfig: {
    description?: string
  } | null
}

export const ChatMessageContainer = memo(function ChatMessageContainer({
  messages,
  isLoading,
  showScrollButton,
  messagesContainerRef,
  messagesEndRef,
  scrollToBottom,
  scrollToMessage,
  chatConfig,
}: ChatMessageContainerProps) {
  return (
    <div className='relative flex flex-1 flex-col overflow-hidden bg-white'>
      <style jsx>{`
        @keyframes growShrink {
          0%,
          100% {
            transform: scale(0.9);
          }
          50% {
            transform: scale(1.1);
          }
        }
        .loading-dot {
          animation: growShrink 1.5s infinite ease-in-out;
        }
      `}</style>

      {/* Scrollable Messages Area */}
      <div
        ref={messagesContainerRef}
        className='absolute inset-0 touch-pan-y overflow-y-auto overscroll-auto scroll-smooth'
      >
        <div className='mx-auto max-w-3xl px-4 pt-10 pb-20'>
          {messages.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-10'>
              <div className='space-y-2 text-center'>
                <h3 className='font-medium text-lg'>How can I help you today?</h3>
                <p className='text-muted-foreground text-sm'>
                  {chatConfig?.description || 'Ask me anything.'}
                </p>
              </div>
            </div>
          ) : (
            messages.map((message) => <ClientChatMessage key={message.id} message={message} />)
          )}

          {/* Loading indicator (shows only when executing) */}
          {isLoading && (
            <div className='px-4 py-5'>
              <div className='mx-auto max-w-3xl'>
                <div className='flex'>
                  <div className='max-w-[80%]'>
                    <div className='flex h-6 items-center'>
                      <div className='loading-dot h-3 w-3 rounded-full bg-gray-800 dark:bg-gray-300' />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* End of messages marker for scrolling */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Scroll to bottom button - appears when user scrolls up */}
      {showScrollButton && (
        <div className='-translate-x-1/2 absolute bottom-16 left-1/2 z-20 transform'>
          <Button
            onClick={scrollToBottom}
            size='sm'
            variant='outline'
            className='flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 shadow-lg transition-all hover:bg-gray-50'
          >
            <ArrowDown className='h-3.5 w-3.5' />
            <span className='sr-only'>Scroll to bottom</span>
          </Button>
        </div>
      )}
    </div>
  )
})

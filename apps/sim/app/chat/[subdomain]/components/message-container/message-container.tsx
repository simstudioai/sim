'use client'

import React, { RefObject } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChatMessage, ClientChatMessage } from '../message/message'

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

export function ChatMessageContainer({
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
    <div className="relative flex-1 overflow-hidden bg-white flex flex-col">
      {/* Scrollable Messages Area */}
      <div
        ref={messagesContainerRef}
        className="absolute inset-0 overflow-y-auto scroll-smooth overscroll-auto touch-pan-y"
      >
        <div className="max-w-3xl mx-auto px-4 pt-10 pb-20">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-medium">How can I help you today?</h3>
                <p className="text-muted-foreground text-sm">
                  {chatConfig?.description || 'Ask me anything.'}
                </p>
              </div>
            </div>
          ) : (
            messages.map((message) => <ClientChatMessage key={message.id} message={message} />)
          )}

          {/* Loading indicator (shows only when executing) */}
          {isLoading && (
            <div className="py-5 px-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex">
                  <div className="max-w-[80%]">
                    <div className="flex items-center h-6">
                      <div className="w-3 h-3 rounded-full bg-gray-800 dark:bg-gray-300 loading-dot"></div>
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
        <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 z-20">
          <Button
            onClick={scrollToBottom}
            size="sm"
            variant="outline"
            className="rounded-full py-1 px-3 border border-gray-200 bg-white shadow-lg hover:bg-gray-50 transition-all flex items-center gap-1"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span className="sr-only">Scroll to bottom</span>
          </Button>
        </div>
      )}
    </div>
  )
}

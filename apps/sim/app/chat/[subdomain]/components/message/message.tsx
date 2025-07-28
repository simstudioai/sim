'use client'

import { memo, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToolCallCompletion, ToolCallExecution } from '@/components/ui/tool-call'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { parseMessageContent, stripToolCallIndicators } from '@/lib/tool-call-parser'
import MarkdownRenderer from '@/app/chat/[subdomain]/components/message/components/markdown-renderer'

export interface ChatMessage {
  id: string
  content: string | Record<string, unknown>
  type: 'user' | 'assistant'
  timestamp: Date
  isInitialMessage?: boolean
  isStreaming?: boolean
}

function EnhancedMarkdownRenderer({ content }: { content: string }) {
  return (
    <TooltipProvider>
      <MarkdownRenderer content={content} />
    </TooltipProvider>
  )
}

export const ClientChatMessage = memo(
  function ClientChatMessage({ message }: { message: ChatMessage }) {
    const [isCopied, setIsCopied] = useState(false)

    const isJsonObject = useMemo(() => {
      return typeof message.content === 'object' && message.content !== null
    }, [message.content])

    // Parse message content to separate text and tool calls (only for assistant messages)
    const parsedContent = useMemo(() => {
      if (message.type === 'assistant' && typeof message.content === 'string') {
        return parseMessageContent(message.content)
      }
      return null
    }, [message.type, message.content])

    // Get clean text content without tool call indicators
    const cleanTextContent = useMemo(() => {
      if (message.type === 'assistant' && typeof message.content === 'string') {
        return stripToolCallIndicators(message.content)
      }
      return message.content
    }, [message.type, message.content])

    // For user messages (on the right)
    if (message.type === 'user') {
      return (
        <div className='px-4 py-5' data-message-id={message.id}>
          <div className='mx-auto max-w-3xl'>
            <div className='flex justify-end'>
              <div className='max-w-[80%] rounded-3xl bg-[#F4F4F4] px-4 py-3 dark:bg-gray-600'>
                <div className='whitespace-pre-wrap break-words text-base text-gray-800 leading-relaxed dark:text-gray-100'>
                  {isJsonObject ? (
                    <pre>{JSON.stringify(message.content, null, 2)}</pre>
                  ) : (
                    <span>{message.content as string}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // For assistant messages (on the left)
    return (
      <div className='px-4 pt-5 pb-2' data-message-id={message.id}>
        <div className='mx-auto max-w-3xl'>
          <div className='flex flex-col space-y-3'>
            {/* Inline content rendering - tool calls and text in order */}
            {parsedContent?.inlineContent && parsedContent.inlineContent.length > 0 ? (
              <div className='space-y-2'>
                {parsedContent.inlineContent.map((item, index) => {
                  if (item.type === 'tool_call' && item.toolCall) {
                    const toolCall = item.toolCall
                    return (
                      <div key={`${toolCall.id}-${index}`}>
                        {toolCall.state === 'detecting' && (
                          <div className='flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-800 dark:bg-blue-950'>
                            <div className='h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400' />
                            <span className='text-blue-800 dark:text-blue-200'>
                              Detecting {toolCall.displayName || toolCall.name}...
                            </span>
                          </div>
                        )}
                        {toolCall.state === 'executing' && (
                          <ToolCallExecution toolCall={toolCall} isCompact={true} />
                        )}
                        {(toolCall.state === 'completed' || toolCall.state === 'error') && (
                          <ToolCallCompletion toolCall={toolCall} isCompact={true} />
                        )}
                      </div>
                    )
                  }
                  if (item.type === 'text' && item.content.trim()) {
                    return (
                      <div key={`text-${index}`}>
                        <div className='break-words text-base'>
                          <EnhancedMarkdownRenderer content={item.content} />
                        </div>
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            ) : (
              /* Fallback for empty content or no inline content */
              <div>
                <div className='break-words text-base'>
                  {isJsonObject ? (
                    <pre className='text-gray-800 dark:text-gray-100'>
                      {JSON.stringify(cleanTextContent, null, 2)}
                    </pre>
                  ) : (
                    <EnhancedMarkdownRenderer content={cleanTextContent as string} />
                  )}
                </div>
              </div>
            )}
            {message.type === 'assistant' && !isJsonObject && !message.isInitialMessage && (
              <div className='flex items-center justify-start space-x-2'>
                {/* Copy Button - Only show when not streaming */}
                {!message.isStreaming && (
                  <TooltipProvider>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='flex items-center gap-1.5 px-2 py-1'
                          onClick={() => {
                            const contentToCopy =
                              typeof cleanTextContent === 'string'
                                ? cleanTextContent
                                : JSON.stringify(cleanTextContent, null, 2)
                            navigator.clipboard.writeText(contentToCopy)
                            setIsCopied(true)
                            setTimeout(() => setIsCopied(false), 2000)
                          }}
                        >
                          {isCopied ? (
                            <>
                              <Check className='h-3.5 w-3.5 text-green-500' />
                            </>
                          ) : (
                            <>
                              <Copy className='h-3.5 w-3.5 text-muted-foreground' />
                            </>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side='top' align='center' sideOffset={5}>
                        {isCopied ? 'Copied!' : 'Copy to clipboard'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.isStreaming === nextProps.message.isStreaming &&
      prevProps.message.isInitialMessage === nextProps.message.isInitialMessage
    )
  }
)

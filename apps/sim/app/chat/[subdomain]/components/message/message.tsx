'use client'

import { memo, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import MarkdownRenderer from './components/markdown-renderer'

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
          <div className='flex flex-col'>
            <div>
              <div className='break-words text-base'>
                {isJsonObject ? (
                  <pre className='text-gray-800 dark:text-gray-100'>
                    {JSON.stringify(message.content, null, 2)}
                  </pre>
                ) : (
                  <EnhancedMarkdownRenderer content={message.content as string} />
                )}
              </div>
            </div>
            {message.type === 'assistant' &&
              !isJsonObject &&
              !message.isInitialMessage &&
              !message.isStreaming && (
                <div className='flex justify-start'>
                  <TooltipProvider>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='flex items-center gap-1.5 px-2 py-1'
                          onClick={() => {
                            navigator.clipboard.writeText(message.content as string)
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

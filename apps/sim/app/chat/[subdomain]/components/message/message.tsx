'use client'

import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import MarkdownRenderer from '../markdown-renderer/markdown-renderer'

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

export function ClientChatMessage({ message }: { message: ChatMessage }) {
  const [isCopied, setIsCopied] = useState(false)
  const isJsonObject = useMemo(() => {
    return typeof message.content === 'object' && message.content !== null
  }, [message.content])

  // For user messages (on the right)
  if (message.type === 'user') {
    return (
      <div className="py-5 px-4" data-message-id={message.id}>
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-end">
            <div className="bg-[#F4F4F4] dark:bg-gray-600 rounded-3xl max-w-[80%] py-3 px-4">
              <div className="whitespace-pre-wrap break-words text-base leading-relaxed text-gray-800 dark:text-gray-100">
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
    <div className="pt-5 pb-2 px-4" data-message-id={message.id}>
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-col">
          <div>
            <div className="break-words text-base">
              {isJsonObject ? (
                <pre className="text-gray-800 dark:text-gray-100">
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
              <div className="flex justify-start">
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex items-center gap-1.5 px-2 py-1"
                        onClick={() => {
                          navigator.clipboard.writeText(message.content as string)
                          setIsCopied(true)
                          setTimeout(() => setIsCopied(false), 2000)
                        }}
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" sideOffset={5}>
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
}

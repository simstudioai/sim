'use client'

import { memo, useMemo, useState } from 'react'
import { Check, Copy, File as FileIcon, FileText, Image as ImageIcon } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import MarkdownRenderer from './components/markdown-renderer'

export interface ChatAttachment {
  id: string
  name: string
  type: string
  dataUrl: string
  size?: number
}

export interface ChatMessage {
  id: string
  content: string | Record<string, unknown>
  type: 'user' | 'assistant'
  timestamp: Date
  isInitialMessage?: boolean
  isStreaming?: boolean
  attachments?: ChatAttachment[]
}

function EnhancedMarkdownRenderer({ content }: { content: string }) {
  return <MarkdownRenderer content={content} />
}

export const ClientChatMessage = memo(
  function ClientChatMessage({ message }: { message: ChatMessage }) {
    const [isCopied, setIsCopied] = useState(false)

    const isJsonObject = useMemo(() => {
      return typeof message.content === 'object' && message.content !== null
    }, [message.content])

    // Since tool calls are now handled via SSE events and stored in message.toolCalls,
    // we can use the content directly without parsing
    const cleanTextContent = message.content

    const content =
      message.type === 'user' ? (
        <div className='px-4 py-5' data-message-id={message.id}>
          <div className='mx-auto max-w-3xl'>
            {/* File attachments displayed above the message */}
            {message.attachments && message.attachments.length > 0 && (
              <div className='mb-2 flex justify-end'>
                <div className='flex flex-wrap gap-2'>
                  {message.attachments.map((attachment) => {
                    const isImage = attachment.type.startsWith('image/')
                    const getFileIcon = (type: string) => {
                      if (type.includes('pdf'))
                        return (
                          <FileText className='h-5 w-5 text-gray-500 md:h-6 md:w-6 dark:text-gray-400' />
                        )
                      if (type.startsWith('image/'))
                        return (
                          <ImageIcon className='h-5 w-5 text-gray-500 md:h-6 md:w-6 dark:text-gray-400' />
                        )
                      if (type.includes('text') || type.includes('json'))
                        return (
                          <FileText className='h-5 w-5 text-gray-500 md:h-6 md:w-6 dark:text-gray-400' />
                        )
                      return (
                        <FileIcon className='h-5 w-5 text-gray-500 md:h-6 md:w-6 dark:text-gray-400' />
                      )
                    }
                    const formatFileSize = (bytes?: number) => {
                      if (!bytes || bytes === 0) return ''
                      const k = 1024
                      const sizes = ['B', 'KB', 'MB', 'GB']
                      const i = Math.floor(Math.log(bytes) / Math.log(k))
                      return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
                    }

                    return (
                      <div
                        key={attachment.id}
                        className={`relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800 ${
                          attachment.dataUrl?.trim() && attachment.dataUrl.startsWith('data:')
                            ? 'cursor-pointer'
                            : ''
                        } ${
                          isImage
                            ? 'h-16 w-16 md:h-20 md:w-20'
                            : 'flex h-16 min-w-[140px] max-w-[220px] items-center gap-2 px-3 md:h-20 md:min-w-[160px] md:max-w-[240px]'
                        }`}
                        onClick={(e) => {
                          const validDataUrl = attachment.dataUrl?.trim()
                          if (validDataUrl?.startsWith('data:')) {
                            e.preventDefault()
                            e.stopPropagation()
                            const newWindow = window.open('', '_blank')
                            if (newWindow) {
                              newWindow.document.write(`
                                <!DOCTYPE html>
                                <html>
                                  <head>
                                    <title>${attachment.name}</title>
                                    <style>
                                      body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
                                      img { max-width: 100%; max-height: 100vh; object-fit: contain; }
                                    </style>
                                  </head>
                                  <body>
                                    <img src="${validDataUrl}" alt="${attachment.name}" />
                                  </body>
                                </html>
                              `)
                              newWindow.document.close()
                            }
                          }
                        }}
                      >
                        {isImage &&
                        attachment.dataUrl?.trim() &&
                        attachment.dataUrl.startsWith('data:') ? (
                          <img
                            src={attachment.dataUrl}
                            alt={attachment.name}
                            className='h-full w-full object-cover'
                          />
                        ) : (
                          <>
                            <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-gray-100 md:h-12 md:w-12 dark:bg-gray-700'>
                              {getFileIcon(attachment.type)}
                            </div>
                            <div className='min-w-0 flex-1'>
                              <div className='truncate font-medium text-gray-800 text-xs md:text-sm dark:text-gray-200'>
                                {attachment.name}
                              </div>
                              {attachment.size && (
                                <div className='text-[10px] text-gray-500 md:text-xs dark:text-gray-400'>
                                  {formatFileSize(attachment.size)}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Only render message bubble if there's actual text content (not just file count message) */}
            {message.content && !String(message.content).startsWith('Sent') && (
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
            )}
          </div>
        </div>
      ) : (
        <div className='px-4 pt-5 pb-2' data-message-id={message.id}>
          <div className='mx-auto max-w-3xl'>
            <div className='flex flex-col space-y-3'>
              {/* Direct content rendering - tool calls are now handled via SSE events */}
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
              {message.type === 'assistant' && !isJsonObject && !message.isInitialMessage && (
                <div className='flex items-center justify-start space-x-2'>
                  {/* Copy Button - Only show when not streaming */}
                  {!message.isStreaming && (
                    <Tooltip.Root delayDuration={300}>
                      <Tooltip.Trigger asChild>
                        <button
                          className='text-muted-foreground transition-colors hover:bg-muted'
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
                            <Check className='h-3 w-3' strokeWidth={2} />
                          ) : (
                            <Copy className='h-3 w-3' strokeWidth={2} />
                          )}
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top' align='center' sideOffset={5}>
                        {isCopied ? 'Copied!' : 'Copy to clipboard'}
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )

    return <Tooltip.Provider>{content}</Tooltip.Provider>
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
